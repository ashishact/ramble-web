/**
 * Claim Deriver
 *
 * Layer 2: Derives Claims from Layer 1 primitives (Proposition + Stance)
 *
 * Claims are not extracted directly - they are computed from:
 * - Proposition: What was said (content, subject, type)
 * - Stance: How it was held (epistemic, volitional, deontic, affective)
 */

import type { Proposition, Stance } from '../schemas/primitives'
import type { CreateClaim, ClaimType, Stakes, Temporality, Abstraction, SourceType } from '../types'
import { now } from '../utils/time'
import { createLogger } from '../utils/logger'

const logger = createLogger('ClaimDeriver')

// ============================================================================
// Claim Derivation
// ============================================================================

/**
 * Derive a Claim from a Proposition and its associated Stance
 */
export function deriveClaim(
  proposition: Proposition,
  stance: Stance,
  extractionProgramId: string = 'primitive-deriver'
): CreateClaim {
  const claimType = inferClaimType(proposition, stance)
  const stakes = inferStakes(stance)
  const temporality = inferTemporality(proposition, stance)
  const abstraction = inferAbstraction(proposition)
  const sourceType = inferSourceType(stance)

  logger.debug('Deriving claim', {
    propositionId: proposition.id,
    stanceId: stance.id,
    claimType,
    stakes,
  })

  return {
    statement: proposition.content,
    subject: proposition.subject,
    claimType,
    temporality,
    abstraction,
    sourceType,
    initialConfidence: stance.epistemic.certainty,
    emotionalValence: stance.affective.valence,
    emotionalIntensity: stance.affective.arousal,
    stakes,
    validFrom: now(),
    validUntil: null,
    extractionProgramId,
    elaborates: null,
  }
}

// ============================================================================
// Claim Type Inference
// ============================================================================

/**
 * Infer ClaimType from stance dimensions
 *
 * Priority order (first match wins):
 * 1. Volitional type (intention, goal, concern, preference)
 * 2. Deontic type (commitment)
 * 3. Affective (emotion)
 * 4. Epistemic (factual, belief)
 * 5. Proposition type (hypothetical)
 * 6. Default (belief)
 */
export function inferClaimType(proposition: Proposition, stance: Stance): ClaimType {
  const { volitional, deontic, affective, epistemic } = stance

  // Volitional types
  if (volitional.type === 'intend' && volitional.strength > 0.5) {
    return 'intention'
  }
  if (volitional.type === 'want' && volitional.strength > 0.6) {
    return 'goal'
  }
  if (volitional.type === 'fear' && volitional.strength > 0.4) {
    return 'concern'
  }
  if (volitional.type === 'prefer' && volitional.strength > 0.4) {
    return 'preference'
  }
  if (volitional.type === 'hope' && volitional.strength > 0.5) {
    return 'goal' // Hope is goal-like
  }

  // Deontic types
  if (deontic.type === 'must' && deontic.strength > 0.6) {
    return 'commitment'
  }
  if (deontic.type === 'should' && deontic.strength > 0.5) {
    return 'commitment'
  }

  // Affective types - strong emotions
  if (affective.arousal > 0.7 || (affective.emotions && affective.emotions.length > 0)) {
    return 'emotion'
  }

  // Epistemic types
  if (epistemic.certainty > 0.8 && epistemic.evidence === 'direct') {
    return 'factual'
  }

  // Proposition type
  if (proposition.type === 'hypothetical') {
    return 'hypothetical'
  }

  // Default based on certainty
  if (epistemic.certainty < 0.6) {
    return 'belief'
  }

  // If high certainty but not direct evidence, still belief
  if (epistemic.evidence === 'inferred' || epistemic.evidence === 'assumption') {
    return 'belief'
  }

  return 'belief'
}

// ============================================================================
// Stakes Inference
// ============================================================================

/**
 * Infer stakes level from stance dimensions
 *
 * Factors:
 * - High affective arousal + negative valence → high stakes
 * - High volitional strength → medium to high
 * - High deontic strength → medium to high
 * - Strong emotions (fear, anger) → high
 */
export function inferStakes(stance: Stance): Stakes {
  const { volitional, deontic, affective } = stance

  // Existential: extreme emotion or fear with high strength
  if (
    (affective.arousal > 0.9 && Math.abs(affective.valence) > 0.8) ||
    (volitional.type === 'fear' && volitional.strength > 0.8)
  ) {
    return 'existential'
  }

  // High: strong negative affect, or strong commitment, or fear
  if (
    (affective.arousal > 0.7 && affective.valence < -0.3) ||
    (deontic.strength > 0.7 && deontic.type === 'must') ||
    (volitional.type === 'fear' && volitional.strength > 0.5)
  ) {
    return 'high'
  }

  // Medium: moderate affect or commitment
  if (
    affective.arousal > 0.5 ||
    volitional.strength > 0.6 ||
    deontic.strength > 0.5
  ) {
    return 'medium'
  }

  return 'low'
}

// ============================================================================
// Other Inferences
// ============================================================================

/**
 * Infer temporality from proposition and stance
 */
function inferTemporality(proposition: Proposition, stance: Stance): Temporality {
  // Events are point in time
  if (proposition.type === 'event') {
    return 'pointInTime'
  }

  // High certainty + direct evidence suggests slower decay
  if (stance.epistemic.certainty > 0.8 && stance.epistemic.evidence === 'direct') {
    return 'slowlyDecaying'
  }

  // Generic propositions tend to be eternal
  if (proposition.type === 'generic') {
    return 'eternal'
  }

  // Emotional states decay faster
  if (stance.affective.arousal > 0.7) {
    return 'fastDecaying'
  }

  // Default
  return 'slowlyDecaying'
}

/**
 * Infer abstraction level from proposition
 */
function inferAbstraction(proposition: Proposition): Abstraction {
  if (proposition.type === 'generic') {
    return 'universal'
  }
  if (proposition.type === 'hypothetical') {
    return 'general'
  }
  return 'specific'
}

/**
 * Infer source type from stance
 */
function inferSourceType(stance: Stance): SourceType {
  if (stance.epistemic.evidence === 'direct') {
    return 'direct'
  }
  if (stance.epistemic.evidence === 'inferred') {
    return 'inferred'
  }
  return 'direct' // Default
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Derive multiple claims from proposition-stance pairs
 */
export function deriveClaimsFromPrimitives(
  pairs: Array<{ proposition: Proposition; stance: Stance }>,
  extractionProgramId: string = 'primitive-deriver'
): CreateClaim[] {
  return pairs.map(({ proposition, stance }) =>
    deriveClaim(proposition, stance, extractionProgramId)
  )
}
