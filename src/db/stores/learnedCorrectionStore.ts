/**
 * LearnedCorrectionStore - Context-aware correction storage and matching
 *
 * Features:
 * - Store corrections with 3-word context on each side
 * - Fuzzy context matching with probability scores
 * - Learn from user edits over time
 */

import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import LearnedCorrection from '../models/LearnedCorrection'

const learnedCorrections = database.get<LearnedCorrection>('learned_corrections')

/**
 * Calculate similarity between two context arrays using word overlap
 * Returns a score between 0 and 1
 */
function contextSimilarity(context1: string[], context2: string[]): number {
  if (context1.length === 0 && context2.length === 0) return 1
  if (context1.length === 0 || context2.length === 0) return 0.3 // Partial match possible

  const set1 = new Set(context1.map(w => w.toLowerCase()))
  const set2 = new Set(context2.map(w => w.toLowerCase()))

  let matches = 0
  for (const word of set1) {
    if (set2.has(word)) matches++
  }

  // Weight by position - closer words matter more
  // For now, simple overlap ratio
  return matches / Math.max(set1.size, set2.size)
}

/**
 * Extract words from text, normalized to lowercase
 */
function extractWords(text: string): string[] {
  return text.match(/[a-zA-Z]+(?:'[a-zA-Z]+)?/g)?.map(w => w.toLowerCase()) || []
}

/**
 * Get context around a word at a specific position
 */
function getContext(
  words: string[],
  startIdx: number,
  endIdx: number,
  contextSize = 3
): { left: string[]; right: string[] } {
  const left = words.slice(Math.max(0, startIdx - contextSize), startIdx)
  const right = words.slice(endIdx, endIdx + contextSize)
  return { left, right }
}

export interface LearnedMatch {
  id: string
  original: string
  corrected: string
  confidence: number      // Overall confidence (count-based)
  contextScore: number    // How well the current context matches
  combinedScore: number   // Combined score for ranking
  leftContext: string[]
  rightContext: string[]
}

export const learnedCorrectionStore = {
  /**
   * Create or update a learned correction
   */
  async learn(data: {
    original: string
    corrected: string
    leftContext: string[]
    rightContext: string[]
  }): Promise<LearnedCorrection> {
    const now = Date.now()
    const originalLower = data.original.toLowerCase()

    // Check if we already have this exact correction with similar context
    const existing = await this.findSimilar(
      originalLower,
      data.leftContext,
      data.rightContext,
      0.8 // High threshold for "same" correction
    )

    if (existing.length > 0 && existing[0].contextScore >= 0.8) {
      // Update existing
      const match = existing[0]
      const correction = await learnedCorrections.find(match.id)
      await database.write(async () => {
        await correction.update((c) => {
          c.count += 1
          c.confidence = Math.min(1, (c.count + 1) / (c.count + 2)) // Bayesian-ish
          c.lastUsedAt = now
        })
      })
      return correction
    }

    // Create new
    return await database.write(async () => {
      return await learnedCorrections.create((c) => {
        c.original = originalLower
        c.corrected = data.corrected
        c.leftContext = JSON.stringify(data.leftContext.map(w => w.toLowerCase()))
        c.rightContext = JSON.stringify(data.rightContext.map(w => w.toLowerCase()))
        c.count = 1
        c.confidence = 0.5 // Initial confidence
        c.createdAt = now
      })
    })
  },

  /**
   * Find corrections that match the given word with context scoring
   */
  async findSimilar(
    word: string,
    leftContext: string[],
    rightContext: string[],
    minContextScore = 0
  ): Promise<LearnedMatch[]> {
    const wordLower = word.toLowerCase()

    // Get all corrections for this word
    const corrections = await learnedCorrections
      .query(Q.where('original', wordLower))
      .fetch()

    if (corrections.length === 0) return []

    // Score each correction based on context match
    const matches: LearnedMatch[] = corrections.map((c) => {
      const storedLeft = c.leftContextParsed
      const storedRight = c.rightContextParsed

      const leftScore = contextSimilarity(leftContext, storedLeft)
      const rightScore = contextSimilarity(rightContext, storedRight)

      // Average context score
      const contextScore = (leftScore + rightScore) / 2

      // Combine context score with confidence (count-based)
      // Higher count = more reliable
      const countBoost = Math.min(1, c.count / 5) // Max boost at 5 uses
      const combinedScore = contextScore * 0.6 + c.confidence * 0.2 + countBoost * 0.2

      return {
        id: c.id,
        original: c.original,
        corrected: c.corrected,
        confidence: c.confidence,
        contextScore,
        combinedScore,
        leftContext: storedLeft,
        rightContext: storedRight,
      }
    })

    // Filter by minimum context score and sort by combined score
    return matches
      .filter((m) => m.contextScore >= minContextScore)
      .sort((a, b) => b.combinedScore - a.combinedScore)
  },

  /**
   * Find all potential corrections for a text
   * Returns matches with their positions and confidence
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
    const allCorrections = await learnedCorrections.query().fetch()
    const knownErrors = new Set(allCorrections.map((c) => c.original))

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

    // Check each word
    for (let i = 0; i < wordPositions.length; i++) {
      const { word, start, end } = wordPositions[i]
      const wordLower = word.toLowerCase()

      if (!knownErrors.has(wordLower)) continue

      // Get context
      const { left, right } = getContext(words, i, i + 1, 3)

      // Find matching corrections
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

  /**
   * Get all learned corrections
   */
  async getAll(): Promise<LearnedCorrection[]> {
    return await learnedCorrections
      .query(Q.sortBy('count', Q.desc))
      .fetch()
  },

  /**
   * Get most used corrections
   */
  async getMostUsed(limit = 20): Promise<LearnedCorrection[]> {
    return await learnedCorrections
      .query(Q.sortBy('count', Q.desc), Q.take(limit))
      .fetch()
  },

  /**
   * Delete a correction
   */
  async delete(id: string): Promise<boolean> {
    try {
      const correction = await learnedCorrections.find(id)
      await database.write(async () => {
        await correction.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },

  /**
   * Record that a correction was used
   */
  async recordUsage(id: string): Promise<void> {
    try {
      const correction = await learnedCorrections.find(id)
      await database.write(async () => {
        await correction.update((c) => {
          c.count += 1
          c.confidence = Math.min(1, (c.count + 1) / (c.count + 2))
          c.lastUsedAt = Date.now()
        })
      })
    } catch {
      // Not found
    }
  },
}

// Export utility functions for use elsewhere
export { extractWords, getContext }
