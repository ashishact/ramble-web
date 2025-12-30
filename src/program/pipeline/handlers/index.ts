/**
 * Pipeline Handlers Module
 *
 * Exports all pipeline task handlers.
 */

export * from './types';
export { PreprocessUnitHandler, createPreprocessUnitHandler } from './preprocessUnitHandler';
export { ExtractPrimitivesHandler, createExtractPrimitivesHandler } from './extractPrimitivesHandler';
export { ResolveAndDeriveHandler, createResolveAndDeriveHandler } from './resolveAndDeriveHandler';
export { NonLLMObserversHandler, createNonLLMObserversHandler } from './nonllmObserversHandler';
export { LLMObserversHandler, createLLMObserversHandler } from './llmObserversHandler';

import type { PipelineTaskHandler } from './types';
import { createPreprocessUnitHandler } from './preprocessUnitHandler';
import { createExtractPrimitivesHandler } from './extractPrimitivesHandler';
import { createResolveAndDeriveHandler } from './resolveAndDeriveHandler';
import { createNonLLMObserversHandler } from './nonllmObserversHandler';
import { createLLMObserversHandler } from './llmObserversHandler';
import type { ObserverDispatcher } from '../../observers/dispatcher';

/**
 * Create all pipeline handlers
 */
export function createAllHandlers(dispatcher?: ObserverDispatcher): PipelineTaskHandler[] {
  const handlers: PipelineTaskHandler[] = [
    createPreprocessUnitHandler(),
    createExtractPrimitivesHandler(),
    createResolveAndDeriveHandler(),
  ];

  // Create observer handlers with dispatcher if provided
  const nonLLMHandler = createNonLLMObserversHandler();
  const llmHandler = createLLMObserversHandler();

  if (dispatcher) {
    nonLLMHandler.setDispatcher(dispatcher);
    llmHandler.setDispatcher(dispatcher);
  }

  handlers.push(nonLLMHandler, llmHandler);

  return handlers;
}
