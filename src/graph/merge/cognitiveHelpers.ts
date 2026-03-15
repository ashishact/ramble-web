/**
 * Cognitive Helpers — Pure Scoring Functions
 *
 * All the cognitive modeling formulas (decay, reinforcement, composite score)
 * extracted as pure functions. These are the same formulas used in the
 * WatermelonDB pipeline, preserved exactly.
 */

import type { MemoryState, MemoryOrigin } from '../types'

// ============================================================================
// Composite Score
// ============================================================================

/**
 * Composite relevance score combining multiple signals.
 *
 * Weights:
 *   activity × 0.30  — How recently/frequently accessed
 *   importance × 0.20 — LLM-assigned significance
 *   confidence × 0.15 — How sure we are of this fact
 *   recency × 0.35    — Time-based decay
 */
export function compositeScore(params: {
  activityScore: number
  importance: number
  confidence: number
  lastReinforced: number
}): number {
  const recency = recencyScore(params.lastReinforced)
  return (
    params.activityScore * 0.30 +
    params.importance * 0.20 +
    params.confidence * 0.15 +
    recency * 0.35
  )
}

// ============================================================================
// Recency Score
// ============================================================================

/**
 * Recency score with 7-day half-life.
 * Math.exp(-0.15 * daysSince) gives ~0.35 at 7 days, ~0.05 at 20 days.
 */
export function recencyScore(lastReinforced: number): number {
  const daysSince = (Date.now() - lastReinforced) / 86_400_000
  return Math.exp(-0.15 * daysSince)
}

// ============================================================================
// Activity Score Decay
// ============================================================================

/**
 * Exponential activity score decay.
 * Same 7-day half-life as recency: activityScore * exp(-0.15 * days)
 * Zeroes out below 0.01 threshold.
 */
export function decayActivityScore(activityScore: number, lastReinforced: number): number {
  const daysSince = (Date.now() - lastReinforced) / 86_400_000
  const decayed = activityScore * Math.exp(-0.15 * daysSince)
  return decayed < 0.01 ? 0 : decayed
}

// ============================================================================
// Confidence Priors
// ============================================================================

/**
 * Confidence prior based on how the information entered the system.
 * Higher confidence for direct speech (user is asserting something)
 * vs pasted/document content (may not be the user's own knowledge).
 */
export function confidencePrior(origin: MemoryOrigin): number {
  switch (origin) {
    case 'speech': return 0.60
    case 'typed': return 0.55
    case 'meeting': return 0.50
    case 'pasted': return 0.40
    case 'document': return 0.35
    default: return 0.50
  }
}

// ============================================================================
// Ownership Priors
// ============================================================================

/**
 * Ownership score — how much the user "owns" this information.
 * Speech gets highest ownership (user is directly asserting).
 * Documents get lowest (may be someone else's knowledge).
 */
export function ownershipPrior(origin: MemoryOrigin): number {
  switch (origin) {
    case 'speech': return 0.70
    case 'typed': return 0.65
    case 'meeting': return 0.60
    case 'pasted': return 0.40
    case 'document': return 0.30
    default: return 0.50
  }
}

// ============================================================================
// Memory State Transitions
// ============================================================================

/**
 * Valid state transitions:
 *   provisional → stable (after reinforcement)
 *   provisional → superseded (newer info replaces)
 *   provisional → retracted (user says "that's wrong")
 *   stable → contested (contradicted by new info)
 *   stable → superseded (newer info replaces)
 *   stable → retracted (user says "that's wrong")
 *   contested → stable (contradiction resolved)
 *   contested → superseded
 *   contested → retracted
 */
export function canTransition(from: MemoryState, to: MemoryState): boolean {
  const transitions: Record<MemoryState, MemoryState[]> = {
    provisional: ['stable', 'contested', 'superseded', 'retracted'],
    stable: ['contested', 'superseded', 'retracted'],
    contested: ['stable', 'superseded', 'retracted'],
    superseded: ['retracted'],
    retracted: [],
  }
  return transitions[from]?.includes(to) ?? false
}

/**
 * Reinforcement effects:
 * - Bump importance by +0.05 (capped at 1.0)
 * - Bump activity score by +0.2 (capped at 1.0)
 * - Transition provisional → stable after enough reinforcements
 */
export function applyReinforcement(props: {
  importance: number
  activityScore: number
  reinforceCount: number
  state: MemoryState
}): {
  importance: number
  activityScore: number
  reinforceCount: number
  state: MemoryState
  lastReinforced: number
} {
  const newImportance = Math.min(1.0, props.importance + 0.05)
  const newActivity = Math.min(1.0, props.activityScore + 0.2)
  const newCount = props.reinforceCount + 1

  // Transition provisional → stable after 3 reinforcements
  let newState = props.state
  if (props.state === 'provisional' && newCount >= 3) {
    newState = 'stable'
  }

  return {
    importance: newImportance,
    activityScore: newActivity,
    reinforceCount: newCount,
    state: newState,
    lastReinforced: Date.now(),
  }
}
