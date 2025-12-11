/**
 * Memory Module
 *
 * Exports for working memory, long-term memory, salience, and decay.
 */

export { MemoryService, createMemoryService } from './memoryService';
export { createDecayHandler, executeDecayTask, type DecayHandlerConfig } from './decayHandler';
