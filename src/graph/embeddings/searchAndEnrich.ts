/**
 * Search & Enrich — Shared search pipeline for SYS-I and SYS-II
 *
 * Performs a two-phase search with BM25 re-ranking, broadening fallback,
 * quality-aware truncation, and result enrichment with connected edges.
 *
 * Pipeline:
 *   1. Filtered search (match requested type: entity/memory/goal)
 *   2. If no strong candidates (>= STRONG_THRESHOLD), broaden to all types
 *      and mix broadened results in with a relevance penalty
 *   3. Quality-aware truncation: if top result is strong, aggressively
 *      drop weak tail results to keep context focused
 *   4. Enrich each result with properties + connected edges/nodes
 */

import type { GraphService } from '../GraphService'
import type { EmbeddingService } from './EmbeddingService'
import { VectorSearch, type VectorSearchResult } from './VectorSearch'
import type { GraphNode } from '../types'

// ── Thresholds ───────────────────────────────────────────────────────

/** Relevance penalty applied to broadened (cross-type) results */
const BROADEN_PENALTY = 0.85

/** Minimum combined score from filtered search to skip broadening */
const BROADEN_SKIP_THRESHOLD = 0.5

/** Minimum fuzzy score to consider a name/alias match */
const FUZZY_THRESHOLD = 0.8

// ── Phase 0: Fuzzy Name/Alias Match ─────────────────────────────────

/** Jaro-Winkler string similarity (0–1, higher = more similar) */
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0

  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatched = new Array<boolean>(a.length).fill(false)
  const bMatched = new Array<boolean>(b.length).fill(false)
  let matches = 0

  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(b.length - 1, i + range)
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue
      aMatched[i] = true
      bMatched[j] = true
      matches++
      break
    }
  }
  if (matches === 0) return 0

  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }

  const jaro = (
    matches / a.length +
    matches / b.length +
    (matches - transpositions / 2) / matches
  ) / 3

  // Winkler boost for common prefix (up to 4 chars)
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

/**
 * Phase 0: Direct name/alias text match.
 * Catches exact, substring, and fuzzy (Jaro-Winkler) matches that
 * embedding search misses — especially short proper names like "Asis".
 */
async function findByNameOrAlias(
  query: string,
  graph: GraphService,
  labelFilter: string,
  limit: number,
): Promise<VectorSearchResult[]> {
  const q = query.toLowerCase().trim()
  if (!q) return []

  // Fetch all named nodes of the requested type.
  // For <1000 nodes this is sub-millisecond; precise scoring happens in JS.
  const rows = await graph.query<GraphNode>(`
    SELECT * FROM nodes
    WHERE json_extract_string(properties, '$.name') IS NOT NULL
      AND list_contains(labels, $1)
  `, [labelFilter])

  const results: VectorSearchResult[] = []

  for (const node of rows) {
    const props = node.properties as Record<string, unknown>
    const name = String(props.name ?? '').toLowerCase()
    const aliases = (Array.isArray(props.aliases) ? props.aliases as string[] : [])
      .map(a => String(a).toLowerCase())

    let best = 0

    // Name: exact → substring → fuzzy
    if (name === q) best = 1.0
    else if (name.includes(q) || q.includes(name)) best = Math.max(best, 0.95)
    best = Math.max(best, jaroWinkler(name, q))

    // Aliases: same scoring ladder
    for (const alias of aliases) {
      if (alias === q) { best = 1.0; break }
      if (alias.includes(q) || q.includes(alias)) best = Math.max(best, 0.95)
      best = Math.max(best, jaroWinkler(alias, q))
    }

    if (best >= FUZZY_THRESHOLD) {
      results.push({ node, similarity: best })
    }
  }

  results.sort((a, b) => b.similarity - a.similarity)
  return results.slice(0, limit)
}

// ── Types ────────────────────────────────────────────────────────────

export interface SearchRequest {
  query: string
  type: 'entity' | 'memory' | 'goal'
  /** Max results to return (after relevance filtering). Default: 2 */
  limit?: number
  /** Minimum composite similarity score (0–1). Results below this are excluded. Default: 0.6 */
  relevance?: number
}

// ── Main Pipeline ────────────────────────────────────────────────────

export async function searchAndEnrich(
  req: SearchRequest,
  graph: GraphService,
  embeddings: EmbeddingService,
): Promise<string> {
  const vs = new VectorSearch(graph, embeddings)
  const limit = req.limit ?? 2
  const relevance = req.relevance ?? 0.6

  // Internal candidate limit — fetch generously so relevance filtering has a good pool
  const candidateLimit = Math.max(limit * 3, 10)

  const labelFilter = req.type === 'entity' ? 'entity'
    : req.type === 'goal' ? 'goal'
    : 'memory'

  // Phase 0: Fuzzy name/alias text match (catches short proper names
  // that produce weak embedding vectors, e.g. "Asis", "Ashish")
  const nameMatches = await findByNameOrAlias(req.query, graph, labelFilter, candidateLimit)

  // Phase 1: Filtered vector search (requested type)
  let results = await vs.searchByText(req.query, candidateLimit, labelFilter)

  // Merge Phase 0 + Phase 1 (name matches take priority on dedup)
  if (nameMatches.length > 0) {
    const nameIds = new Set(nameMatches.map(r => r.node.id))
    const vectorOnly = results.filter(r => !nameIds.has(r.node.id))
    results = [...nameMatches, ...vectorOnly]
    results.sort((a, b) => b.similarity - a.similarity)
  }

  // Phase 2: Broadening — if no strong candidates in filtered results,
  // search without type filter to find relevant info in other node types
  // (e.g., entity info might live in a memory's content)
  const bestFiltered = results.length > 0 ? results[0].similarity : 0

  if (bestFiltered < BROADEN_SKIP_THRESHOLD) {
    const broadened = await vs.searchByText(req.query, candidateLimit)

    // Deduplicate (filtered results take priority)
    const seenIds = new Set(results.map(r => r.node.id))
    const extras: VectorSearchResult[] = []
    for (const br of broadened) {
      if (seenIds.has(br.node.id)) continue
      // Apply penalty so type-matched results rank higher
      extras.push({ ...br, similarity: br.similarity * BROADEN_PENALTY })
    }

    // Merge and re-sort
    results = [...results, ...extras]
    results.sort((a, b) => b.similarity - a.similarity)
  }

  if (results.length === 0) {
    return `No results found for: "${req.query}"`
  }

  // Phase 3: Relevance floor + limit cap
  // Filter by minimum similarity, then cap at requested limit
  results = truncateByQuality(results, relevance, limit)

  // Phase 4: Enrich with properties + edges
  const sections = await Promise.all(results.map(r =>
    enrichResult(r, req.type, graph)
  ))

  return sections.join('\n\n')
}

// ── Quality-Aware Truncation ─────────────────────────────────────────
// Applies the relevance floor (drop results below threshold) then caps
// at the requested limit. Always returns at least 1 result if any exist.

function truncateByQuality(
  results: VectorSearchResult[],
  relevance: number,
  limit: number,
): VectorSearchResult[] {
  if (results.length === 0) return results

  // Filter by relevance floor
  const filtered = results.filter(r => r.similarity >= relevance)

  // Always keep at least 1 result if we had candidates
  if (filtered.length === 0) return results.slice(0, 1)

  return filtered.slice(0, limit)
}

// ── Result Enrichment ────────────────────────────────────────────────

async function enrichResult(
  r: VectorSearchResult,
  requestedType: string,
  graph: GraphService,
): Promise<string> {
  const props = r.node.properties as Record<string, unknown>
  const score = r.similarity.toFixed(2)

  // Determine actual label for display (may differ from requested if broadened)
  const labels = r.node.labels ?? []
  const actualType = labels.includes(requestedType) ? requestedType
    : labels.find(l => ['entity', 'memory', 'goal', 'topic'].includes(l)) ?? requestedType

  const lines: string[] = []
  const name = String(props.name ?? props.content ?? props.statement ?? props.title ?? r.node.id)
  lines.push(`[${actualType}] ${name} (relevance: ${score})`)

  // Key properties
  if (props.type) lines.push(`  type: ${props.type}`)
  if (props.description) lines.push(`  description: ${props.description}`)
  if (props.aliases && Array.isArray(props.aliases) && props.aliases.length > 0) {
    lines.push(`  aliases: ${props.aliases.join(', ')}`)
  }
  if (props.content && props.name) lines.push(`  content: ${props.content}`)
  if (props.statement) lines.push(`  statement: ${props.statement}`)
  if (props.status) lines.push(`  status: ${props.status}`)
  if (props.progress != null) lines.push(`  progress: ${props.progress}`)
  if (props.state && props.state !== 'stable') lines.push(`  state: ${props.state}`)
  if (props.importance != null) lines.push(`  importance: ${Number(props.importance).toFixed(1)}`)

  // Connected edges + target nodes
  try {
    const edges = await graph.query<{
      type: string, start_id: string, end_id: string,
      target_name: string | null, target_content: string | null,
      target_labels: string[], direction: string
    }>(`
      SELECT e.type, e.start_id, e.end_id,
        json_extract_string(n2.properties, '$.name') as target_name,
        json_extract_string(n2.properties, '$.content') as target_content,
        n2.labels as target_labels,
        CASE WHEN e.start_id = $1 THEN 'out' ELSE 'in' END as direction
      FROM edges e
      JOIN nodes n2 ON n2.id = CASE WHEN e.start_id = $1 THEN e.end_id ELSE e.start_id END
      WHERE (e.start_id = $1 OR e.end_id = $1)
      LIMIT 15
    `, [r.node.id])

    if (edges.length > 0) {
      lines.push('  relationships:')
      for (const edge of edges) {
        const targetLabel = edge.target_name ?? edge.target_content ?? ''
        if (!targetLabel) continue
        const arrow = edge.direction === 'out' ? '\u2192' : '\u2190'
        lines.push(`    ${arrow} ${edge.type}: ${targetLabel}`)
      }
    }
  } catch {
    // Edge fetch failed — still return the node info
  }

  return lines.join('\n')
}
