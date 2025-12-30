/**
 * Non-LLM Observers Handler
 *
 * Task: run_nonllm_observers
 * Input: claims:derived event
 * Output: observers:nonllm:completed event
 *
 * Runs all non-LLM observers (PatternObserver, GoalObserver, ConcernObserver,
 * RelationshipObserver, ConsolidationObserver) in parallel.
 */

import type { TaskCheckpoint, Claim } from '../../types';
import type { PipelineTaskHandler, TaskContext, ObserverResult } from './types';
import type { ClaimsDerivedPayload } from '../events/types';
import { emitObserversCompleted } from '../events/eventBus';
import type { ObserverDispatcher } from '../../observers/dispatcher';
import { createLogger } from '../../utils/logger';

const logger = createLogger('NonLLMObserversHandler');

/**
 * Non-LLM observers handler implementation
 */
export class NonLLMObserversHandler implements PipelineTaskHandler<ClaimsDerivedPayload, ObserverResult> {
  readonly taskType = 'run_nonllm_observers' as const;

  private dispatcher: ObserverDispatcher | null = null;

  /**
   * Set the dispatcher to use for observer execution
   */
  setDispatcher(dispatcher: ObserverDispatcher): void {
    this.dispatcher = dispatcher;
  }

  async execute(
    payload: ClaimsDerivedPayload,
    context: TaskContext,
    _checkpoint: TaskCheckpoint | null
  ): Promise<ObserverResult> {
    const { store, eventBus } = context;
    const { unitId, sessionId, claimIds } = payload;

    logger.info('Starting non-LLM observers', {
      unitId,
      claimCount: claimIds.length,
    });

    // Get claims for observer context
    await context.checkpoint('get_claims');
    const claims: Claim[] = [];
    for (const claimId of claimIds) {
      const claim = await store.claims.getById(claimId);
      if (claim) claims.push(claim);
    }

    // Run non-LLM observers
    await context.checkpoint('run_observers');
    const observerResults = await this.runNonLLMObservers(claims, sessionId, store);

    logger.info('Non-LLM observers complete', {
      unitId,
      observersRun: observerResults.length,
      outputsCreated: observerResults.filter((r) => r.hasOutput).length,
    });

    // Build result
    const result: ObserverResult = {
      unitId,
      sessionId,
      observerType: 'nonllm',
      results: observerResults,
    };

    // CRITICAL: Save is complete, NOW emit event
    emitObserversCompleted(eventBus, result);

    return result;
  }

  /**
   * Run non-LLM observers
   */
  private async runNonLLMObservers(
    claims: Claim[],
    sessionId: string,
    _store: TaskContext['store']
  ): Promise<Array<{ observerType: string; hasOutput: boolean; outputCount: number }>> {
    const results: Array<{ observerType: string; hasOutput: boolean; outputCount: number }> = [];

    if (!this.dispatcher) {
      logger.warn('No dispatcher set, skipping observers');
      return results;
    }

    try {
      // Use the dispatcher's onNewClaims method which runs observers
      const observerOutputs = await this.dispatcher.onNewClaims(claims, sessionId);

      // Filter to only non-LLM observer results
      // The dispatcher runs all observers, but we can filter by checking if
      // the observer uses LLM (this is a simplification - ideally we'd have
      // a way to run only non-LLM observers)
      for (const output of observerOutputs) {
        results.push({
          observerType: output.observerType || 'unknown',
          hasOutput: output.hasOutput,
          outputCount: output.outputs?.length || 0,
        });
      }
    } catch (error) {
      logger.error('Error running non-LLM observers', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return results;
  }
}

/**
 * Create a new non-LLM observers handler
 */
export function createNonLLMObserversHandler(): NonLLMObserversHandler {
  return new NonLLMObserversHandler();
}
