/**
 * Memory Dedup Gate — Pre-write duplicate detection
 *
 * Two-tier bigram similarity check before creating a new memory:
 *
 *   Tier 1 — Near-identical (>= 0.95): True duplicate. Reinforce existing, skip creation.
 *   Tier 2 — Similar but different (0.80–0.94): Updated fact. Create new & supersede old.
 *   Below 0.80: Distinct memory, create normally.
 *
 * This file is standalone — remove the ~10-line import + call in processor.ts
 * saveExtraction() and everything reverts cleanly.
 */

import { memoryStore } from '../../db/stores'
import { createLogger } from '../utils/logger'

const logger = createLogger('MemoryDedup')

// ============================================================================
// Similarity (copied from consolidation.ts — kept separate to avoid coupling)
// ============================================================================

/**
 * Bigram Dice coefficient — fast string similarity for in-memory scanning.
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const aBigrams = new Set<string>()
  const bBigrams = new Set<string>()
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()

  for (let i = 0; i < aLower.length - 1; i++) {
    aBigrams.add(aLower.slice(i, i + 2))
  }
  for (let i = 0; i < bLower.length - 1; i++) {
    bBigrams.add(bLower.slice(i, i + 2))
  }

  let intersection = 0
  for (const bigram of aBigrams) {
    if (bBigrams.has(bigram)) intersection++
  }

  return (2 * intersection) / (aBigrams.size + bBigrams.size)
}

// ============================================================================
// Dedup Gate
// ============================================================================

export type DedupResult =
  | { action: 'create' }
  | { action: 'reinforce'; existingId: string }
  | { action: 'supersede'; existingId: string }

/**
 * Check whether a new memory content is a duplicate of an existing one.
 *
 * Returns:
 *   - 'create'    — no duplicate found, create normally
 *   - 'reinforce' — near-identical match, just reinforce the existing memory
 *   - 'supersede' — similar but updated, create new and supersede the old one
 */
export async function checkMemoryDuplicate(content: string): Promise<DedupResult> {
  const activeMemories = await memoryStore.getActive(200)

  let bestScore = 0
  let bestId = ''

  for (const existing of activeMemories) {
    const score = stringSimilarity(content, existing.content)
    if (score > bestScore) {
      bestScore = score
      bestId = existing.id
    }
  }

  if (bestScore >= 0.95) {
    logger.debug('Near-identical duplicate found', { score: bestScore, existingId: bestId })
    return { action: 'reinforce', existingId: bestId }
  }

  if (bestScore >= 0.80) {
    logger.debug('Similar-but-updated duplicate found', { score: bestScore, existingId: bestId })
    return { action: 'supersede', existingId: bestId }
  }

  return { action: 'create' }
}
