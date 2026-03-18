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

// ── Thresholds ───────────────────────────────────────────────────────

/** Results above this are "strong" — triggers truncation of weak tail */
const STRONG_THRESHOLD = 0.7

/** When we have a strong hit, drop results below this */
const WEAK_CUTOFF = 0.45

/** Relevance penalty applied to broadened (cross-type) results */
const BROADEN_PENALTY = 0.85

/** Minimum combined score from filtered search to skip broadening */
const BROADEN_SKIP_THRESHOLD = 0.5

// ── Types ────────────────────────────────────────────────────────────

export interface SearchRequest {
  query: string
  type: 'entity' | 'memory' | 'goal'
}

// ── Main Pipeline ────────────────────────────────────────────────────

export async function searchAndEnrich(
  req: SearchRequest,
  graph: GraphService,
  embeddings: EmbeddingService,
  maxResults: number,
): Promise<string> {
  const vs = new VectorSearch(graph, embeddings)

  const labelFilter = req.type === 'entity' ? 'entity'
    : req.type === 'goal' ? 'goal'
    : 'memory'

  // Phase 1: Filtered search (requested type)
  let results = await vs.searchByText(req.query, maxResults, labelFilter)

  // Phase 2: Broadening — if no strong candidates in filtered results,
  // search without type filter to find relevant info in other node types
  // (e.g., entity info might live in a memory's content)
  const bestFiltered = results.length > 0 ? results[0].similarity : 0

  if (bestFiltered < BROADEN_SKIP_THRESHOLD) {
    const broadened = await vs.searchByText(req.query, maxResults)

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

  // Phase 3: Quality-aware truncation
  results = truncateByQuality(results, maxResults)

  // Phase 4: Enrich with properties + edges
  const sections = await Promise.all(results.map(r =>
    enrichResult(r, req.type, graph)
  ))

  return sections.join('\n\n')
}

// ── Quality-Aware Truncation ─────────────────────────────────────────
// If the top result is strong (>0.7), we don't need mediocre results
// polluting the LLM context. Aggressively trim the tail.

function truncateByQuality(
  results: VectorSearchResult[],
  maxResults: number,
): VectorSearchResult[] {
  if (results.length === 0) return results

  const topScore = results[0].similarity
  const hasStrongHit = topScore >= STRONG_THRESHOLD

  if (hasStrongHit) {
    // Keep only results above weak cutoff
    const strong = results.filter(r => r.similarity >= WEAK_CUTOFF)
    // But always keep at least 1, at most maxResults
    return strong.length > 0
      ? strong.slice(0, maxResults)
      : results.slice(0, 1)
  }

  // No strong hit — return all up to limit
  return results.slice(0, maxResults)
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
