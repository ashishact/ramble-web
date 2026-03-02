/**
 * Kernel Module Exports
 */

export { getKernel, type KernelState, type InputResult } from './kernel';
export { processInput, type ProcessingResult } from './processor';
export { recordingManager } from './recordingManager';
export { retrieveContext, type RetrievedContext } from './contextRetrieval';
export { runConsolidation, runConsolidationIfDue, initConsolidation } from './consolidation';
