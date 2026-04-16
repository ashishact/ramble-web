/**
 * Coverage Scorer — Knowledge Map
 *
 * Calculates topic coverage depth via vector search.
 * Two tiers:
 *   - Base coverage: from graph topics (cached in profileStorage)
 *   - Live coverage: from SYS-I real-time topic detections
 *
 * Merged together for the sunburst visualization.
 */

import { profileStorage } from '../../../lib/profileStorage'

// ── Types ──────────────────────────────────────────────────────────────

export interface TopicCoverage {
  topicName: string       // Full name, e.g. "Career / Job Search"
  domain: string          // Parsed domain, e.g. "Career"
  shortName: string       // Parsed topic, e.g. "Job Search"
  mentionCount: number
  score: number           // 0-1 depth from vector search (matchCount / 10, capped)
  matchCount: number      // Similar nodes found in vector DB
  isLive: boolean         // From current SYS-I session
  lastSeen: number
}

export interface CoverageCache {
  lastPeriodKey: string
  calculatedAt: number
  topics: TopicCoverage[]
}

const CACHE_KEY = 'knowledge-map-coverage'
const SIMILARITY_THRESHOLD = 0.5
const MAX_MATCHES_FOR_FULL_SCORE = 10

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Parse "Domain / Topic" format into domain + shortName.
 * If no slash, domain defaults to "General".
 */
export function parseDomainTopic(name: string | undefined | null): { domain: string; shortName: string } {
  if (!name || typeof name !== 'string') {
    return { domain: 'General', shortName: 'Unknown' }
  }
  const match = name.match(/^(.+?)\s*\/\s*(.+)$/)
  if (!match) {
    return { domain: 'General', shortName: name.trim() }
  }
  return {
    domain: match[1].trim(),
    shortName: match[2].trim(),
  }
}

// ── Coverage Calculation ───────────────────────────────────────────────

/**
 * Calculate coverage score for a single topic name via vector search.
 * Lazy-imports graph dependencies to avoid loading them at module init.
 */
export async function calculateTopicCoverage(topicName: string): Promise<{
  score: number
  matchCount: number
}> {
  const { getGraphService, getEmbeddingListener } = await import('../../../graph')
  const { VectorSearch } = await import('../../../graph/embeddings/VectorSearch')

  const graph = await getGraphService()
  const listener = await getEmbeddingListener()
  const vs = new VectorSearch(graph, listener.getService())

  const results = await vs.searchByText(topicName, 20)
  // Exclude topic nodes (self-matches) — only count content nodes (entities, memories, etc.)
  const matches = results.filter(r =>
    r.similarity >= SIMILARITY_THRESHOLD &&
    !r.node.labels?.includes('topic')
  )
  const matchCount = matches.length
  const score = Math.min(1, matchCount / MAX_MATCHES_FOR_FULL_SCORE)

  return { score, matchCount }
}

/**
 * Calculate base coverage for all known topics.
 *
 * Source of truth: the `topic` column in the conversations table,
 * populated by SYS-I for every response. This covers all discussed
 * topics regardless of whether SYS-II has run or been committed.
 */
export async function calculateBaseCoverage(): Promise<TopicCoverage[]> {
  const { getGraphService } = await import('../../../graph')
  const graph = await getGraphService()

  const rows = await graph.query<{ topic: string; cnt: number; last_seen: number }>(
    `SELECT topic, COUNT(*) as cnt, MAX(created_at) as last_seen
     FROM conversations
     WHERE topic IS NOT NULL AND topic != 'general' AND speaker = 'sys1'
     GROUP BY topic
     ORDER BY last_seen DESC`,
  )

  const coverage: TopicCoverage[] = []

  for (const row of rows) {
    const { domain, shortName } = parseDomainTopic(row.topic)

    try {
      const { score, matchCount } = await calculateTopicCoverage(row.topic)
      coverage.push({
        topicName: row.topic,
        domain,
        shortName,
        mentionCount: row.cnt,
        score,
        matchCount,
        isLive: false,
        lastSeen: row.last_seen,
      })
    } catch (err) {
      console.warn('[KnowledgeMap] Failed to score topic:', row.topic, err)
      coverage.push({
        topicName: row.topic,
        domain,
        shortName,
        mentionCount: row.cnt,
        score: 0,
        matchCount: 0,
        isLive: false,
        lastSeen: row.last_seen,
      })
    }
  }

  return coverage
}

/**
 * Calculate coverage for a single live SYS-I topic.
 */
export async function calculateLiveTopicCoverage(topicName: string): Promise<TopicCoverage> {
  const { domain, shortName } = parseDomainTopic(topicName)

  try {
    const { score, matchCount } = await calculateTopicCoverage(topicName)
    return {
      topicName,
      domain,
      shortName,
      mentionCount: 1,
      score,
      matchCount,
      isLive: true,
      lastSeen: Date.now(),
    }
  } catch (err) {
    console.warn('[KnowledgeMap] Failed to score live topic:', topicName, err)
    return {
      topicName,
      domain,
      shortName,
      mentionCount: 1,
      score: 0,
      matchCount: 0,
      isLive: true,
      lastSeen: Date.now(),
    }
  }
}

// ── Cache ──────────────────────────────────────────────────────────────

export function loadCachedCoverage(): CoverageCache | null {
  return profileStorage.getJSON<CoverageCache>(CACHE_KEY)
}

export function saveCachedCoverage(cache: CoverageCache): void {
  profileStorage.setJSON(CACHE_KEY, cache)
}

// ── Merge ──────────────────────────────────────────────────────────────

/**
 * Merge base + live coverage. Same topic → take higher score.
 * Live topics retain the isLive flag.
 */
export function mergeCoverage(base: TopicCoverage[], live: TopicCoverage[]): TopicCoverage[] {
  const map = new Map<string, TopicCoverage>()

  for (const t of base) {
    map.set(t.topicName, { ...t })
  }

  for (const t of live) {
    const existing = map.get(t.topicName)
    if (existing) {
      // Take higher score, mark as live, bump mention count
      map.set(t.topicName, {
        ...existing,
        score: Math.max(existing.score, t.score),
        matchCount: Math.max(existing.matchCount, t.matchCount),
        mentionCount: existing.mentionCount + t.mentionCount,
        isLive: true,
        lastSeen: Math.max(existing.lastSeen, t.lastSeen),
      })
    } else {
      map.set(t.topicName, { ...t })
    }
  }

  return Array.from(map.values())
}

// ── Embedding-Based Grouping ────────────────────────────────────────

const GROUP_SIMILARITY_THRESHOLD = 0.75

/**
 * Group similar topics by embedding cosine similarity.
 * Merges slight LLM variations ("API speed tradeoffs" + "API integration changes")
 * into a single visual group. Representative = highest mention count.
 */
export async function groupSimilarTopics(topics: TopicCoverage[]): Promise<TopicCoverage[]> {
  if (topics.length <= 1) return topics

  // Lazy-import embedding service
  const { getEmbeddingListener } = await import('../../../graph')
  const listener = await getEmbeddingListener()
  const embeddingService = listener.getService()

  // Embed all topic names
  const embeddings: (number[] | null)[] = await Promise.all(
    topics.map(t => embeddingService.embed(t.topicName).catch(() => null))
  )

  // Greedy grouping: assign each topic to the first group whose representative is similar enough
  const groups: { representative: number; members: number[] }[] = []

  for (let i = 0; i < topics.length; i++) {
    if (!embeddings[i]) {
      // Embedding failed — treat as its own group
      groups.push({ representative: i, members: [i] })
      continue
    }

    let assigned = false
    for (const group of groups) {
      const repEmb = embeddings[group.representative]
      if (!repEmb) continue
      const sim = cosineSimilarity(embeddings[i]!, repEmb)
      if (sim >= GROUP_SIMILARITY_THRESHOLD) {
        group.members.push(i)
        // Update representative to the one with higher mention count
        if (topics[i].mentionCount > topics[group.representative].mentionCount) {
          group.representative = i
        }
        assigned = true
        break
      }
    }

    if (!assigned) {
      groups.push({ representative: i, members: [i] })
    }
  }

  // Build grouped topics — representative takes aggregated stats
  return groups.map(g => {
    const rep = topics[g.representative]
    const totalMentions = g.members.reduce((sum, idx) => sum + topics[idx].mentionCount, 0)
    const maxScore = Math.max(...g.members.map(idx => topics[idx].score))
    const maxMatchCount = Math.max(...g.members.map(idx => topics[idx].matchCount))
    const isLive = g.members.some(idx => topics[idx].isLive)
    const lastSeen = Math.max(...g.members.map(idx => topics[idx].lastSeen))

    return {
      ...rep,
      mentionCount: totalMentions,
      score: maxScore,
      matchCount: maxMatchCount,
      isLive,
      lastSeen,
    }
  })
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
