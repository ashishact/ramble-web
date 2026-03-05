/**
 * Entity Scorer — Multi-Signal Pair Scoring
 *
 * Five signals combined via Fellegi-Sunter inspired weighted scoring:
 *   1. Jaro-Winkler: name + aliases similarity
 *   2. Jaccard (Milne-Witten inspired): co-occurring entity set overlap
 *   3. Jaccard: topic set overlap
 *   4. Temporal proximity: mention window overlap with exponential decay
 *   5. Type agreement: same=1.0, unknown=0.5, different=0.0 (hard veto)
 */

import { jaroWinklerSimilarity } from './jaroWinkler'
import type { EntityFingerprint, MergeScore } from './types'
import { RESOLUTION_WEIGHTS, THRESHOLDS } from './types'

/** Jaccard similarity for two Sets */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  // Iterate over smaller set for performance
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const item of small) {
    if (big.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Temporal proximity score.
 * If mention windows overlap, score is 1.0.
 * If they don't overlap, score decays exponentially with gap.
 * halfLife = 30 days (in ms).
 */
function temporalProximity(a: EntityFingerprint, b: EntityFingerprint): number {
  const aStart = a.firstMentioned
  const aEnd = a.lastMentioned
  const bStart = b.firstMentioned
  const bEnd = b.lastMentioned

  // Check for window overlap
  if (aStart <= bEnd && bStart <= aEnd) return 1.0

  // Gap between the two windows
  const gap = Math.max(aStart - bEnd, bStart - aEnd)

  // Exponential decay: half-life = 30 days
  const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000
  return Math.exp(-0.693 * gap / HALF_LIFE_MS) // ln(2) ≈ 0.693
}

/**
 * Best name similarity between incoming and candidate.
 * Checks incoming name against candidate name + all aliases.
 * Also does word-level partial matching for multi-word names.
 */
function bestNameSimilarity(incoming: EntityFingerprint, candidate: EntityFingerprint): number {
  let best = jaroWinklerSimilarity(incoming.nameNormalized, candidate.nameNormalized)

  // Check against each alias
  for (const alias of candidate.aliases) {
    const sim = jaroWinklerSimilarity(incoming.nameNormalized, alias.toLowerCase())
    if (sim > best) best = sim
  }

  // Check incoming aliases against candidate name (for existing→existing merges)
  for (const alias of incoming.aliases) {
    const sim = jaroWinklerSimilarity(alias.toLowerCase(), candidate.nameNormalized)
    if (sim > best) best = sim
  }

  // Word-level partial matching for multi-word names
  // e.g. "Charan Tandi" vs "Charanthandi" — check individual words
  const incomingWords = incoming.nameNormalized.split(/\s+/)
  const candidateWords = candidate.nameNormalized.split(/\s+/)

  if (incomingWords.length > 1 || candidateWords.length > 1) {
    // Compare concatenated (no spaces) versions
    const incomingConcat = incomingWords.join('')
    const candidateConcat = candidateWords.join('')
    const concatSim = jaroWinklerSimilarity(incomingConcat, candidateConcat)
    if (concatSim > best) best = concatSim
  }

  return best
}

/**
 * Type agreement score.
 * same type = 1.0, one unknown = 0.5, different types = 0.0
 */
function typeAgreement(incoming: EntityFingerprint, candidate: EntityFingerprint): number {
  if (incoming.type === candidate.type) return 1.0
  if (incoming.type === 'unknown' || candidate.type === 'unknown') return 0.5
  return 0.0
}

/**
 * Score a pair of entity fingerprints.
 * Returns individual signal scores + composite + decision.
 */
export function scoreEntityPair(incoming: EntityFingerprint, candidate: EntityFingerprint): MergeScore {
  const nameSim = bestNameSimilarity(incoming, candidate)
  const cooccJaccard = jaccard(incoming.cooccurringEntityIds, candidate.cooccurringEntityIds)
  const topicJac = jaccard(incoming.topicIds, candidate.topicIds)
  const temporal = temporalProximity(incoming, candidate)
  const typeAgr = typeAgreement(incoming, candidate)

  // Fellegi-Sunter weighted composite
  let composite =
    nameSim * RESOLUTION_WEIGHTS.NAME +
    cooccJaccard * RESOLUTION_WEIGHTS.COOCCURRENCE +
    topicJac * RESOLUTION_WEIGHTS.TOPIC +
    temporal * RESOLUTION_WEIGHTS.TEMPORAL +
    typeAgr * RESOLUTION_WEIGHTS.TYPE

  // Hard veto: type disagreement caps composite below merge threshold
  if (typeAgr === 0.0) {
    composite = Math.min(composite, THRESHOLDS.MAYBE_MERGE - 0.01)
  }

  let decision: MergeScore['decision']
  if (composite >= THRESHOLDS.AUTO_MERGE) {
    decision = 'merge'
  } else if (composite >= THRESHOLDS.MAYBE_MERGE) {
    decision = 'maybe'
  } else {
    decision = 'distinct'
  }

  return {
    nameSimilarity: nameSim,
    cooccurrenceJaccard: cooccJaccard,
    topicJaccard: topicJac,
    temporalProximity: temporal,
    typeAgreement: typeAgr,
    composite,
    decision,
  }
}
