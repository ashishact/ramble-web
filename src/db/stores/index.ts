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
export { createObserverProgramStore } from './observerProgramStore'
export { createObserverOutputStore } from './observerOutputStore'
export { createExtensionStore } from './extensionStore'
export { createSynthesisCacheStore } from './synthesisCacheStore'
export { createCorrectionStore } from './correctionStore'
export { createTaskStore } from './taskStore'

// All 13 stores implemented ✅
