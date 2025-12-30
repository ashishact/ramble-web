/**
 * LLM Observers Handler
 *
 * Task: run_llm_observers
 * Input: observers:nonllm:completed event
 * Output: observers:llm:completed event
 *
 * Runs LLM-based observers (ContradictionObserver, NarrativeObserver)
 * with concurrency limiting.
 */

import type { TaskCheckpoint } from '../../types';
import type { PipelineTaskHandler, TaskContext, ObserverResult } from './types';
import type { ObserversCompletedPayload } from '../events/types';
import { emitObserversCompleted } from '../events/eventBus';
import type { ObserverDispatcher } from '../../observers/dispatcher';
import { createLogger } from '../../utils/logger';

const logger = createLogger('LLMObserversHandler');

/**
 * LLM observers handler implementation
 */
export class LLMObserversHandler implements PipelineTaskHandler<ObserversCompletedPayload, ObserverResult> {
  readonly taskType = 'run_llm_observers' as const;

  // Dispatcher for future use when we implement full LLM observers
  // Currently we run stub observers that check claim counts but don't call LLM
  private dispatcher: ObserverDispatcher | null = null;

  /**
   * Set the dispatcher to use for observer execution
   */
  setDispatcher(dispatcher: ObserverDispatcher): void {
    this.dispatcher = dispatcher;
  }

  /**
   * Get the dispatcher (for testing/debugging)
   */
  getDispatcher(): ObserverDispatcher | null {
    return this.dispatcher;
  }

  async execute(
    payload: ObserversCompletedPayload,
    context: TaskContext,
    _checkpoint: TaskCheckpoint | null
  ): Promise<ObserverResult> {
    const { store, eventBus } = context;
    const { unitId, sessionId } = payload;

    logger.info('Starting LLM observers', { unitId });

    // Run LLM observers
    await context.checkpoint('run_observers');
    const observerResults = await this.runLLMObservers(store);

    logger.info('LLM observers complete', {
      unitId,
      observersRun: observerResults.length,
      outputsCreated: observerResults.filter((r) => r.hasOutput).length,
    });

    // Build result
    const result: ObserverResult = {
      unitId,
      sessionId,
      observerType: 'llm',
      results: observerResults,
    };

    // CRITICAL: Save is complete, NOW emit event
    emitObserversCompleted(eventBus, result);

    return result;
  }

  /**
   * Run LLM observers
   *
   * Currently the dispatcher runs all observers together. In the future,
   * we could modify the dispatcher to support running only LLM observers.
   * For now, we check if there are any LLM-based observations to make.
   */
  private async runLLMObservers(
    store: TaskContext['store']
  ): Promise<Array<{ observerType: string; hasOutput: boolean; outputCount: number }>> {
    const results: Array<{ observerType: string; hasOutput: boolean; outputCount: number }> = [];

    // LLM observers (ContradictionObserver, NarrativeObserver) typically run
    // on accumulated claims rather than individual units. For now, we mark
    // them as complete with no outputs.
    //
    // In the future, this could:
    // 1. Check if there are enough claims for NarrativeObserver (10+ self_perception)
    // 2. Run ContradictionObserver on recent claims
    // 3. Run other LLM-based analysis

    try {
      // Get recent claims to check if we should run LLM observers
      const recentClaims = await store.claims.getRecent(20);

      // ContradictionObserver - check for potential contradictions
      // For now, skip if fewer than 2 claims
      if (recentClaims.length >= 2) {
        // TODO: Run contradiction detection
        results.push({
          observerType: 'contradiction_observer',
          hasOutput: false,
          outputCount: 0,
        });
      }

      // NarrativeObserver - needs 10+ self_perception claims
      const selfPerceptionClaims = recentClaims.filter(
        (c) => c.claimType === 'self_perception'
      );
      if (selfPerceptionClaims.length >= 10) {
        // TODO: Run narrative analysis
        results.push({
          observerType: 'narrative_observer',
          hasOutput: false,
          outputCount: 0,
        });
      }
    } catch (error) {
      logger.error('Error running LLM observers', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return results;
  }
}

/**
 * Create a new LLM observers handler
 */
export function createLLMObserversHandler(): LLMObserversHandler {
  return new LLMObserversHandler();
}
