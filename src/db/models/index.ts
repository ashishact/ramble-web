/**
 * WatermelonDB Models Export
 *
 * Layered Architecture:
 * - Layer 0: Stream (Conversation)
 * - Layer 1: Primitives (Proposition, Stance, Relation, Span, Entity)
 * - Layer 2: Derived (Claim, Goal, Pattern, Value, Contradiction)
 */

// ============================================================================
// LAYER 0: STREAM
// ============================================================================
export { default as Session } from './Session'
export { default as Conversation } from './Conversation'

// ============================================================================
// LAYER 1: PRIMITIVES
// ============================================================================
export { default as Proposition } from './Proposition'
export { default as Stance } from './Stance'
export { default as PropositionRelation } from './PropositionRelation'
export { default as Span } from './Span'
export { default as EntityMention } from './EntityMention'
export { default as PrimitiveEntity } from './PrimitiveEntity'
export { default as Entity } from './Entity'

// ============================================================================
// LAYER 2: DERIVED
// ============================================================================
export { default as Derived } from './Derived'
export { default as Claim } from './Claim'
export { default as Goal } from './Goal'
export { default as Pattern } from './Pattern'
export { default as Value } from './Value'
export { default as Contradiction } from './Contradiction'

// ============================================================================
// PROVENANCE
// ============================================================================
export { default as ClaimSource } from './ClaimSource'

// ============================================================================
// OBSERVERS & EXTRACTORS
// ============================================================================
export { default as ObserverOutput } from './ObserverOutput'
export { default as ExtractionProgram } from './ExtractionProgram'
export { default as ObserverProgram } from './ObserverProgram'

// ============================================================================
// SUPPORT
// ============================================================================
export { default as Extension } from './Extension'
export { default as SynthesisCache } from './SynthesisCache'
export { default as Correction } from './Correction'
export { default as Task } from './Task'

// ============================================================================
// DEBUG / TRACING
// ============================================================================
export { default as ExtractionTrace } from './ExtractionTrace'
