/**
 * BM25 Re-ranker for Vector Search Results
 *
 * Vector (semantic) search can produce false positives where embeddings
 * are close but the content is unrelated:
 *   "Superatom AI" → "Minuet in G Major" (0.57 cosine)
 *
 * This module implements BM25 scoring with fuzzy token matching, then
 * fuses it with the semantic score to filter out noise and re-order.
 *
 * Pipeline:  vector search → BM25 re-rank → enrichment → LLM
 *
 * BM25 formula per query term t in document D:
 *   score(t, D) = IDF(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |D|/avgDL))
 *
 * Where:
 *   tf     = fuzzy term frequency (best bigram-dice match per query token)
 *   IDF    = log((N - n + 0.5) / (n + 0.5) + 1)   (N = doc count, n = docs containing term)
 *   k1     = 1.2 (term saturation)
 *   b      = 0.75 (length normalization)
 *   avgDL  = average document length in tokens
 *
 * Final ranking:
 *   combinedScore = semantic * semanticWeight + bm25Norm * lexicalWeight
 *   Filter: drop if no lexical overlap AND semantic < threshold
 */

import type { VectorSearchResult } from './VectorSearch'

// ── BM25 Parameters ──────────────────────────────────────────────────

const K1 = 1.2    // Term saturation — higher = tf matters more
const B  = 0.75   // Length normalization — 0 = no normalization, 1 = full

// ── Bigram Dice Coefficient ──────────────────────────────────────────
// Fast character-level similarity for fuzzy/typo matching.
// dice("superatom", "superattom") ≈ 0.82  (typo → pass)
// dice("superatom", "minuet")    ≈ 0.0   (unrelated → fail)

function bigrams(s: string): Set<string> {
  const bg = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    bg.add(s.slice(i, i + 2))
  }
  return bg
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bgA = bigrams(a)
  const bgB = bigrams(b)
  let intersection = 0
  for (const bg of bgA) {
    if (bgB.has(bg)) intersection++
  }
  return (2 * intersection) / (bgA.size + bgB.size)
}

// ── Tokenization ─────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

// ── Fuzzy Token Match ────────────────────────────────────────────────
// Returns a 0–1 score for how well a query token matches ANY result token.
// Handles exact matches, prefix matches, and typo variants.

const FUZZY_MIN = 0.6 // Minimum dice score to count as a match

function bestTokenMatch(queryToken: string, docTokens: string[]): number {
  let best = 0
  for (const dt of docTokens) {
    // Exact
    if (queryToken === dt) return 1

    // Prefix (either direction) — fast path
    if (dt.startsWith(queryToken) || queryToken.startsWith(dt)) {
      const ratio = Math.min(queryToken.length, dt.length) / Math.max(queryToken.length, dt.length)
      if (ratio > best) best = ratio
      if (best >= 0.95) return best
      continue
    }

    // Bigram dice (fuzzy)
    const dice = diceCoefficient(queryToken, dt)
    if (dice > best) best = dice
  }
  return best >= FUZZY_MIN ? best : 0
}

// ── BM25 Scoring ─────────────────────────────────────────────────────

interface DocEntry {
  tokens: string[]
  result: VectorSearchResult
}

function computeBM25(
  queryTokens: string[],
  docs: DocEntry[],
): Map<VectorSearchResult, number> {
  const N = docs.length
  const avgDL = docs.reduce((sum, d) => sum + d.tokens.length, 0) / Math.max(N, 1)

  // Compute IDF: for each query token, how many docs contain it (fuzzy)
  const docFreq = new Map<string, number>()
  for (const qt of queryTokens) {
    let count = 0
    for (const doc of docs) {
      if (bestTokenMatch(qt, doc.tokens) > 0) count++
    }
    docFreq.set(qt, count)
  }

  // Score each document
  const scores = new Map<VectorSearchResult, number>()

  for (const doc of docs) {
    let score = 0
    const dl = doc.tokens.length

    for (const qt of queryTokens) {
      const tf = bestTokenMatch(qt, doc.tokens) // fuzzy tf: 0–1
      if (tf === 0) continue

      const n = docFreq.get(qt) ?? 0
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1)
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * dl / avgDL))

      score += idf * tfNorm
    }

    scores.set(doc.result, score)
  }

  return scores
}

// ── Result Text Extraction ───────────────────────────────────────────

function getResultText(node: VectorSearchResult['node']): string {
  const props = node.properties as Record<string, unknown>
  const parts: string[] = []
  if (props.name) parts.push(String(props.name))
  if (props.content) parts.push(String(props.content))
  if (props.description) parts.push(String(props.description))
  if (props.statement) parts.push(String(props.statement))
  if (props.title) parts.push(String(props.title))
  if (props.aliases && Array.isArray(props.aliases)) {
    parts.push(...props.aliases.map(String))
  }
  return parts.join(' ')
}

// ── Public API ───────────────────────────────────────────────────────

export interface RerankOptions {
  /** Weight for semantic (vector) score in fusion. Default: 0.4 */
  semanticWeight?: number
  /** Weight for BM25 (lexical) score in fusion. Default: 0.6 */
  lexicalWeight?: number
  /** Drop results with combined score below this. Default: 0.2 */
  minCombinedScore?: number
  /**
   * If a result has zero lexical overlap, it must have a semantic score
   * above this threshold to survive. Catches embedding false positives
   * like "Superatom AI" → "Minuet in G Major". Default: 0.8
   */
  noLexicalSemanticFloor?: number
}

export interface RankedSearchResult extends VectorSearchResult {
  /** BM25 score (normalized 0–1 relative to top result) */
  bm25Score: number
  /** Fused score: semantic * w1 + bm25Norm * w2 */
  combinedScore: number
}

export function rerankSearchResults(
  query: string,
  results: VectorSearchResult[],
  options?: RerankOptions,
): RankedSearchResult[] {
  if (results.length === 0) return []

  const {
    semanticWeight = 0.4,
    lexicalWeight = 0.6,
    minCombinedScore = 0.2,
    noLexicalSemanticFloor = 0.8,
  } = options ?? {}

  const queryTokens = tokenize(query)

  // Build token lists for all docs
  const docs: DocEntry[] = results.map(r => ({
    tokens: tokenize(getResultText(r.node)),
    result: r,
  }))

  // Compute raw BM25 scores
  const rawScores = computeBM25(queryTokens, docs)

  // Normalize BM25 to 0–1 (relative to max score in this result set)
  let maxBM25 = 0
  for (const s of rawScores.values()) {
    if (s > maxBM25) maxBM25 = s
  }

  // Score, filter, and rank
  const ranked: RankedSearchResult[] = []

  for (const r of results) {
    const raw = rawScores.get(r) ?? 0
    const bm25Score = maxBM25 > 0 ? raw / maxBM25 : 0
    const combinedScore = r.similarity * semanticWeight + bm25Score * lexicalWeight

    // No lexical signal + weak semantic → drop
    if (bm25Score === 0 && r.similarity < noLexicalSemanticFloor) continue

    // Combined too low → drop
    if (combinedScore < minCombinedScore) continue

    ranked.push({ ...r, bm25Score, combinedScore })
  }

  ranked.sort((a, b) => b.combinedScore - a.combinedScore)
  return ranked
}
