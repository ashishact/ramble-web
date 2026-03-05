/**
 * Database Stores Export
 *
 * Core Loop Architecture:
 * - CORE: sessionStore, conversationStore, taskStore
 * - KNOWLEDGE: entityStore, topicStore, memoryStore, goalStore
 * - SYSTEM: pluginStore, correctionStore, extractionLogStore
 */

// Core
export { sessionStore } from './sessionStore'
export { conversationStore } from './conversationStore'
export { taskStore } from './taskStore'

// Knowledge
export { entityStore } from './entityStore'
export { topicStore } from './topicStore'
export { memoryStore } from './memoryStore'
export { goalStore } from './goalStore'

// System
export { pluginStore } from './pluginStore'
export { correctionStore } from './correctionStore'
export { learnedCorrectionStore } from './learnedCorrectionStore'
export { extractionLogStore } from './extractionLogStore'

// Data storage
export { dataStore } from './dataStore'

// Widget records (generic on-demand widget storage)
export { widgetRecordStore } from './widgetRecordStore'

// Recordings + uploaded files (unified pipeline v7)
export { recordingStore } from './recordingStore'
export { uploadedFileStore } from './uploadedFileStore'

// Knowledge tree (v9)
export { knowledgeNodeStore } from './knowledgeNodeStore'
export { cooccurrenceStore } from './cooccurrenceStore'
export { timelineEventStore } from './timelineEventStore'
