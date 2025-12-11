/**
 * WatermelonDB Store Adapters Export
 *
 * Factory functions that create store implementations compatible with IProgramStore interface
 */

export { createSessionStore } from './sessionStore'
export { createConversationStore } from './conversationStore'
export { createClaimStore } from './claimStore'
export { createSourceTrackingStore } from './sourceTrackingStore'
export { createEntityStore } from './entityStore'
export { createGoalStore } from './goalStore'
export { createExtractionProgramStore } from './extractionProgramStore'
export { createCorrectionStore } from './correctionStore'

// TODO: Implement remaining stores:
// - observerOutputStore.ts (includes contradictions, patterns, values sub-stores)
// - observerProgramStore.ts
// - extensionStore.ts
// - synthesisCacheStore.ts

// These can follow the same pattern as the implemented stores above
