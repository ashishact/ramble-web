/**
 * Entity Resolver — Blocking + Scoring Pipeline
 *
 * Two-stage entity resolution:
 *   Stage 1 (Blocking): Cheap filters to reduce candidate set.
 *     Soundex overlap OR prefix-3 match OR alias match.
 *     Loose — false positives are cheap, false negatives are expensive.
 *
 *   Stage 2 (Scoring): scoreEntityPair() each candidate, take best above threshold.
 *
 * Fingerprint cache with 5s TTL to avoid rebuilding within a single extraction batch.
 */

import { buildAllFingerprints, buildIncomingFingerprint } from './entityFingerprint'
import { scoreEntityPair } from './entityScorer'
import type { EntityFingerprint, SessionContext, ResolveResult } from './types'
import { createLogger } from '../utils/logger'
import { telemetry } from '../telemetry'

const logger = createLogger('EntityResolver')

// ============================================================================
// Fingerprint cache — 5s TTL
// ============================================================================

let _fingerprintCache: Map<string, EntityFingerprint> | null = null
let _cacheTimestamp = 0
const CACHE_TTL_MS = 5_000

async function getFingerprints(): Promise<Map<string, EntityFingerprint>> {
  const now = Date.now()
  if (_fingerprintCache && (now - _cacheTimestamp) < CACHE_TTL_MS) {
    return _fingerprintCache
  }

  _fingerprintCache = await buildAllFingerprints()
  _cacheTimestamp = now
  return _fingerprintCache
}

/** Invalidate the fingerprint cache (e.g. after a merge) */
export function invalidateFingerprintCache(): void {
  _fingerprintCache = null
  _cacheTimestamp = 0
}

// ============================================================================
// Blocking (Stage 1) — cheap candidate filtering
// ============================================================================

/**
 * Blocking stage: returns candidate fingerprints that pass at least one
 * cheap filter. Loose on purpose — scoring stage handles precision.
 *
 * Filters:
 *   1. Soundex code overlap (any word)
 *   2. Prefix-3 match on normalized name
 *   3. Alias substring match
 */
function blockCandidates(
  incoming: EntityFingerprint,
  allFingerprints: Map<string, EntityFingerprint>,
): EntityFingerprint[] {
  const candidates: EntityFingerprint[] = []
  const incomingPrefix3 = incoming.nameNormalized.slice(0, 3)

  for (const candidate of allFingerprints.values()) {
    // Don't match against self
    if (candidate.entityId === incoming.entityId) continue

    // Filter 1: Soundex overlap on any word
    const soundexMatch = incoming.soundexCodes.some(code =>
      candidate.soundexCodes.includes(code)
    )
    if (soundexMatch) {
      candidates.push(candidate)
      continue
    }

    // Filter 2: Prefix-3 match
    if (candidate.nameNormalized.slice(0, 3) === incomingPrefix3 && incomingPrefix3.length >= 3) {
      candidates.push(candidate)
      continue
    }

    // Filter 3: Alias match — check if any alias starts with the incoming prefix
    const aliasMatch = candidate.aliases.some(alias => {
      const aliasLower = alias.toLowerCase()
      return aliasLower.startsWith(incomingPrefix3) ||
        incoming.nameNormalized.startsWith(aliasLower.slice(0, 3))
    })
    if (aliasMatch) {
      candidates.push(candidate)
      continue
    }
  }

  return candidates
}

// ============================================================================
// Entity Resolution (Stage 1 + Stage 2)
// ============================================================================

/**
 * Resolve an incoming entity name against the existing entity database.
 *
 * Returns ResolveResult if a match is found (merge or maybe), null if distinct.
 * When null, the caller should create a new entity.
 */
export async function resolveEntity(
  name: string,
  type: string,
  sessionContext: SessionContext,
): Promise<ResolveResult | null> {
  telemetry.emit('entity-resolution', 'blocking', 'start', { name, type })
  const fingerprints = await getFingerprints()

  // Build virtual fingerprint for the incoming entity
  const incoming = buildIncomingFingerprint(name, type, sessionContext)

  // Stage 1: Blocking — cheap candidate filtering
  const candidates = blockCandidates(incoming, fingerprints)
  telemetry.emit('entity-resolution', 'blocking', 'end', { candidates: candidates.length }, { status: 'success' })

  if (candidates.length === 0) {
    logger.debug('No blocking candidates', { name, candidateCount: 0 })
    return null
  }

  // Stage 2: Score each candidate, take best
  telemetry.emit('entity-resolution', 'scoring', 'start', { candidates: candidates.length })
  let bestScore = -1
  let bestCandidate: EntityFingerprint | null = null
  let bestMergeScore: ReturnType<typeof scoreEntityPair> | null = null

  for (const candidate of candidates) {
    const score = scoreEntityPair(incoming, candidate)

    if (score.composite > bestScore) {
      bestScore = score.composite
      bestCandidate = candidate
      bestMergeScore = score
    }
  }
  telemetry.emit('entity-resolution', 'scoring', 'end', {
    bestScore: bestScore.toFixed(3),
    decision: bestMergeScore?.decision,
    matched: bestCandidate?.name,
  }, { status: 'success' })

  if (!bestCandidate || !bestMergeScore) return null

  // Decision: merge or maybe → use existing entity, distinct → create new
  if (bestMergeScore.decision === 'distinct') {
    logger.debug('Best candidate below threshold', {
      name,
      candidate: bestCandidate.name,
      composite: bestMergeScore.composite.toFixed(3),
      decision: bestMergeScore.decision,
    })
    return null
  }

  logger.debug('Entity resolved', {
    name,
    matched: bestCandidate.name,
    composite: bestMergeScore.composite.toFixed(3),
    decision: bestMergeScore.decision,
    nameSim: bestMergeScore.nameSimilarity.toFixed(3),
    cooccJaccard: bestMergeScore.cooccurrenceJaccard.toFixed(3),
    topicJaccard: bestMergeScore.topicJaccard.toFixed(3),
  })

  return {
    entityId: bestCandidate.entityId,
    entityName: bestCandidate.name,
    entityType: bestCandidate.type,
    score: bestMergeScore,
  }
}
