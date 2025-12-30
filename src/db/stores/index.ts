/**
 * WatermelonDB Store Adapters Export
 *
 * Factory functions that create store implementations compatible with IProgramStore interface
 *
 * Layered Architecture:
 * - Layer 0: Stream (conversations)
 * - Layer 1: Primitives (propositions, stances, relations, spans, entities)
 * - Layer 2: Derived (claims, goals, patterns, values, contradictions)
 */

// ============================================================================
// Layer 0: Stream
// ============================================================================
export { createSessionStore } from './sessionStore'
export { createConversationStore } from './conversationStore'

// ============================================================================
// Layer 1: Primitives
// ============================================================================
export { createPropositionStore } from './propositionStore'
export { createStanceStore } from './stanceStore'
export { createRelationStore } from './relationStore'
export { createSpanStore } from './spanStore'
export { createPrimitiveEntityStore } from './primitiveEntityStore'
export { createEntityMentionStore } from './entityMentionStore'
export { createEntityStore } from './entityStore'

// ============================================================================
// Layer 2: Derived
// ============================================================================
export { createDerivedStore } from './derivedStore'
export { createClaimStore } from './claimStore'
export { createGoalStore } from './goalStore'

// ============================================================================
// Observers & Extractors
// ============================================================================
export { createExtractionProgramStore } from './extractionProgramStore'
export { createObserverProgramStore } from './observerProgramStore'
export { createObserverOutputStore } from './observerOutputStore'

// ============================================================================
// Support
// ============================================================================
export { createExtensionStore } from './extensionStore'
export { createSynthesisCacheStore } from './synthesisCacheStore'
export { createCorrectionStore } from './correctionStore'
export { createVocabularyStore } from './vocabularyStore'
export { createTaskStore } from './taskStore'

// ============================================================================
// Debug / Tracing
// ============================================================================
export { createExtractionTraceStore } from './extractionTraceStore'
export type { IExtractionTraceStore, ExtractionTraceRecord, CreateExtractionTrace } from './extractionTraceStore'
