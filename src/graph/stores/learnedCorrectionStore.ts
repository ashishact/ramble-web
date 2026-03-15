/**
 * LearnedCorrectionStore — DuckDB-backed correction storage and matching
 *
 * Used by TranscriptReview for context-aware STT correction.
 *
 * Corrections are stored as graph nodes with label 'learned_correction'.
 */

import { graphMutations } from '../data'

// ============================================================================
// Pure functions (ported from WatermelonDB store)
// ============================================================================

function contextSimilarity(context1: string[], context2: string[]): number {
  if (context1.length === 0 && context2.length === 0) return 1
  if (context1.length === 0 || context2.length === 0) return 0.3
  const set1 = new Set(context1.map(w => w.toLowerCase()))
  const set2 = new Set(context2.map(w => w.toLowerCase()))
  let matches = 0
  for (const word of set1) {
    if (set2.has(word)) matches++
  }
  return matches / Math.max(set1.size, set2.size)
}

export function extractWords(text: string): string[] {
  return text.match(/[a-zA-Z]+(?:'[a-zA-Z]+)?/g)?.map(w => w.toLowerCase()) || []
}

export function getContext(
  words: string[],
  startIdx: number,
  endIdx: number,
  contextSize = 3
): { left: string[]; right: string[] } {
  const left = words.slice(Math.max(0, startIdx - contextSize), startIdx)
  const right = words.slice(endIdx, endIdx + contextSize)
  return { left, right }
}

// ============================================================================
// Types
// ============================================================================

interface CorrectionRecord {
  id: string
  original: string
  corrected: string
  leftContext: string[]
  rightContext: string[]
  count: number
  confidence: number
}

export interface LearnedMatch {
  id: string
  original: string
  corrected: string
  confidence: number
  contextScore: number
  combinedScore: number
  leftContext: string[]
  rightContext: string[]
}

// ============================================================================
// Row parser
// ============================================================================

function parseRow(row: Record<string, unknown>): CorrectionRecord {
  const props = typeof row.properties === 'string'
    ? JSON.parse(row.properties as string)
    : (row.properties ?? {}) as Record<string, unknown>

  let leftContext: string[] = []
  let rightContext: string[] = []
  try {
    leftContext = Array.isArray(props.leftContext) ? props.leftContext as string[]
      : typeof props.leftContext === 'string' ? JSON.parse(props.leftContext) : []
  } catch { /* ignore */ }
  try {
    rightContext = Array.isArray(props.rightContext) ? props.rightContext as string[]
      : typeof props.rightContext === 'string' ? JSON.parse(props.rightContext) : []
  } catch { /* ignore */ }

  return {
    id: row.id as string,
    original: (props.original as string) ?? '',
    corrected: (props.corrected as string) ?? '',
    leftContext,
    rightContext,
    count: (props.count as number) ?? 1,
    confidence: (props.confidence as number) ?? 0.5,
  }
}

// ============================================================================
// Store
// ============================================================================

export const learnedCorrectionStore = {
  /**
   * Create or update a learned correction.
   * If a similar correction with matching context exists, increment its count.
   */
  async learn(data: {
    original: string
    corrected: string
    leftContext: string[]
    rightContext: string[]
  }): Promise<void> {
    const originalLower = data.original.toLowerCase()

    // Check if we already have this correction with similar context
    const existing = await this.findSimilar(
      originalLower,
      data.leftContext,
      data.rightContext,
      0.8
    )

    if (existing.length > 0 && existing[0].contextScore >= 0.8) {
      // Update existing — read current count from node
      const node = await graphMutations.getNode(existing[0].id)
      if (node) {
        const nodeProps = typeof node.properties === 'string'
          ? JSON.parse(node.properties as unknown as string)
          : node.properties
        const currentCount = ((nodeProps as Record<string, unknown>).count as number) ?? 1
        const newCount = currentCount + 1
        await graphMutations.updateNodeProperties(existing[0].id, {
          count: newCount,
          confidence: Math.min(1, (newCount + 1) / (newCount + 2)),
          lastUsedAt: Date.now(),
        })
      }
      return
    }

    // Create new correction node
    await graphMutations.createNode(['learned_correction'], {
      original: originalLower,
      corrected: data.corrected,
      leftContext: data.leftContext.map(w => w.toLowerCase()),
      rightContext: data.rightContext.map(w => w.toLowerCase()),
      count: 1,
      confidence: 0.5,
      created_at: Date.now(),
    })
  },

  /**
   * Find corrections that match the given word with context scoring.
   */
  async findSimilar(
    word: string,
    leftContext: string[],
    rightContext: string[],
    minContextScore = 0
  ): Promise<LearnedMatch[]> {
    const wordLower = word.toLowerCase()

    const rows = await graphMutations.query<Record<string, unknown>>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'learned_correction')
       AND json_extract_string(properties, '$.original') = $1`,
      [wordLower]
    )

    if (rows.length === 0) return []

    const corrections = rows.map(parseRow)

    const matches: LearnedMatch[] = corrections.map(c => {
      const leftScore = contextSimilarity(leftContext, c.leftContext)
      const rightScore = contextSimilarity(rightContext, c.rightContext)
      const contextScore = (leftScore + rightScore) / 2
      const countBoost = Math.min(1, c.count / 5)
      const combinedScore = contextScore * 0.6 + c.confidence * 0.2 + countBoost * 0.2

      return {
        id: c.id,
        original: c.original,
        corrected: c.corrected,
        confidence: c.confidence,
        contextScore,
        combinedScore,
        leftContext: c.leftContext,
        rightContext: c.rightContext,
      }
    })

    return matches
      .filter(m => m.contextScore >= minContextScore)
      .sort((a, b) => b.combinedScore - a.combinedScore)
  },

  /**
   * Find all potential corrections for a text.
   * Returns matches with their positions and confidence.
   */
  async findCorrectionsForText(text: string): Promise<Array<{
    original: string
    corrected: string
    startIndex: number
    endIndex: number
    confidence: number
    contextScore: number
    combinedScore: number
  }>> {
    const words = extractWords(text)
    if (words.length === 0) return []

    // Get all known wrong words
    const allRows = await graphMutations.query<Record<string, unknown>>(
      `SELECT DISTINCT json_extract_string(properties, '$.original') as original
       FROM nodes WHERE list_contains(labels, 'learned_correction')`
    )
    const knownErrors = new Set(allRows.map(r => r.original as string))

    const results: Array<{
      original: string
      corrected: string
      startIndex: number
      endIndex: number
      confidence: number
      contextScore: number
      combinedScore: number
    }> = []

    // Find word positions in original text
    const wordRegex = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g
    const wordPositions: Array<{ word: string; start: number; end: number }> = []
    let match
    while ((match = wordRegex.exec(text)) !== null) {
      wordPositions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }

    for (let i = 0; i < wordPositions.length; i++) {
      const { word, start, end } = wordPositions[i]
      const wordLower = word.toLowerCase()

      if (!knownErrors.has(wordLower)) continue

      const { left, right } = getContext(words, i, i + 1, 3)
      const matches = await this.findSimilar(wordLower, left, right, 0)

      if (matches.length > 0) {
        const best = matches[0]
        results.push({
          original: word,
          corrected: best.corrected,
          startIndex: start,
          endIndex: end,
          confidence: best.confidence,
          contextScore: best.contextScore,
          combinedScore: best.combinedScore,
        })
      }
    }

    return results
  },
}
