/**
 * Observers Module
 *
 * Re-exports observer functionality.
 */

// Types
export type {
  Observer,
  ObserverConfig,
  ObserverContext,
  ObserverResult,
  ObserverEvent,
  DispatcherStats,
} from './types';

// Base class
export { BaseObserver } from './baseObserver';

// Dispatcher
export {
  ObserverDispatcher,
  createDispatcher,
  type DispatcherConfig,
} from './dispatcher';

// Concrete observers
export { ContradictionObserver } from './contradictionObserver';
export { PatternObserver } from './patternObserver';
export { ConcernObserver } from './concernObserver';
export { GoalObserver } from './goalObserver';
export { NarrativeObserver } from './narrativeObserver';
export { RelationshipObserver } from './relationshipObserver';
export { ConsolidationObserver } from './consolidationObserver';

// Registry - creates a dispatcher with all observers registered
import type { ProgramStoreInstance } from '../store/programStore';
import { ObserverDispatcher, type DispatcherConfig } from './dispatcher';
import { ContradictionObserver } from './contradictionObserver';
import { PatternObserver } from './patternObserver';
import { ConcernObserver } from './concernObserver';
import { GoalObserver } from './goalObserver';
import { NarrativeObserver } from './narrativeObserver';
import { RelationshipObserver } from './relationshipObserver';
import { ConsolidationObserver } from './consolidationObserver';

/**
 * Create a dispatcher with all standard observers registered
 */
export function createStandardDispatcher(
  store: ProgramStoreInstance,
  config?: Partial<DispatcherConfig>
): ObserverDispatcher {
  const dispatcher = new ObserverDispatcher(store, config);

  // Register all standard observers (ordered by priority: higher = runs earlier)
  dispatcher.register(new PatternObserver()); // priority 5
  dispatcher.register(new GoalObserver()); // priority 5
  dispatcher.register(new ConcernObserver()); // priority 4
  dispatcher.register(new RelationshipObserver()); // priority 4
  dispatcher.register(new ContradictionObserver()); // priority 3
  dispatcher.register(new NarrativeObserver()); // priority 2
  dispatcher.register(new ConsolidationObserver()); // priority 1

  return dispatcher;
}
