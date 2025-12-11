/**
 * Decay Handler
 *
 * Task handler for the decay_claims task type.
 * Processes all active claims and applies appropriate decay.
 */

import type { MemoryService } from './memoryService';
import type { DecayResult } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('DecayHandler');

/**
 * Configuration for decay handler
 */
export interface DecayHandlerConfig {
  batchSize: number;          // Process in batches (for large datasets)
  staleThreshold: number;     // Mark stale below this confidence
  dormantThreshold: number;   // Mark dormant below this confidence
}

const DEFAULT_DECAY_HANDLER_CONFIG: DecayHandlerConfig = {
  batchSize: 100,
  staleThreshold: 0.2,
  dormantThreshold: 0.1,
};

/**
 * Execute decay claims task
 */
export async function executeDecayTask(
  memoryService: MemoryService,
  _config?: Partial<DecayHandlerConfig>
): Promise<DecayResult> {
  logger.info('Starting decay task');

  try {
    const result = memoryService.runDecay();
    logger.info('Decay task completed', result);
    return result;
  } catch (error) {
    logger.error('Decay task failed', { error });
    throw error;
  }
}

/**
 * Create a decay task handler function
 */
export function createDecayHandler(
  memoryService: MemoryService,
  config?: Partial<DecayHandlerConfig>
): () => Promise<DecayResult> {
  const cfg = { ...DEFAULT_DECAY_HANDLER_CONFIG, ...config };

  return async () => {
    return executeDecayTask(memoryService, cfg);
  };
}
