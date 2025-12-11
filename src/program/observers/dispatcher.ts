/**
 * Observer Dispatcher
 *
 * Coordinates observer execution based on events.
 * Handles scheduling, rate limiting, and result aggregation.
 */

import type { Claim } from '../types';
import type { ProgramStoreInstance } from '../store/programStore';
import type {
  Observer,
  ObserverContext,
  ObserverResult,
  ObserverEvent,
  DispatcherStats,
} from './types';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('Observer');

// ============================================================================
// Dispatcher Configuration
// ============================================================================

export interface DispatcherConfig {
  /** Maximum concurrent LLM-using observers */
  maxConcurrentLLM: number;
  /** Minimum delay between observer runs (ms) */
  minRunInterval: number;
  /** Whether to run observers automatically */
  autoRun: boolean;
}

const DEFAULT_CONFIG: DispatcherConfig = {
  maxConcurrentLLM: 2,
  minRunInterval: 500,
  autoRun: true,
};

// ============================================================================
// Dispatcher Implementation
// ============================================================================

export class ObserverDispatcher {
  private store: ProgramStoreInstance;
  private config: DispatcherConfig;
  private observers: Map<string, Observer> = new Map();
  private lastRunTimes: Map<string, number> = new Map();
  private stats: DispatcherStats = {
    totalEvents: 0,
    totalObserverRuns: 0,
    observerRunsByType: {},
    averageProcessingTimeMs: 0,
    lastEventTimestamp: null,
  };
  private pendingEvents: ObserverEvent[] = [];
  private isProcessing = false;

  constructor(store: ProgramStoreInstance, config?: Partial<DispatcherConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an observer
   */
  register(observer: Observer): void {
    this.observers.set(observer.config.type, observer);
    logger.debug('Registered observer', {
      type: observer.config.type,
      name: observer.config.name,
    });
  }

  /**
   * Unregister an observer
   */
  unregister(observerType: string): void {
    this.observers.delete(observerType);
  }

  /**
   * Dispatch an event to trigger relevant observers
   */
  async dispatch(event: ObserverEvent): Promise<ObserverResult[]> {
    this.stats.totalEvents++;
    this.stats.lastEventTimestamp = event.timestamp;

    if (!this.config.autoRun) {
      this.pendingEvents.push(event);
      return [];
    }

    return this.processEvent(event);
  }

  /**
   * Dispatch a new_claim event
   */
  async onNewClaims(claims: Claim[], sessionId: string): Promise<ObserverResult[]> {
    return this.dispatch({
      type: 'new_claim',
      claims,
      sessionId,
      timestamp: now(),
    });
  }

  /**
   * Dispatch a session_end event
   */
  async onSessionEnd(sessionId: string): Promise<ObserverResult[]> {
    return this.dispatch({
      type: 'session_end',
      sessionId,
      timestamp: now(),
    });
  }

  /**
   * Process pending events (when autoRun is disabled)
   */
  async processPending(): Promise<ObserverResult[]> {
    const results: ObserverResult[] = [];

    while (this.pendingEvents.length > 0) {
      const event = this.pendingEvents.shift()!;
      const eventResults = await this.processEvent(event);
      results.push(...eventResults);
    }

    return results;
  }

  /**
   * Process a single event
   */
  private async processEvent(event: ObserverEvent): Promise<ObserverResult[]> {
    if (this.isProcessing) {
      // Queue the event instead
      this.pendingEvents.push(event);
      return [];
    }

    this.isProcessing = true;
    const results: ObserverResult[] = [];

    try {
      // Get observers that should run for this event
      const observersToRun = this.selectObservers(event);

      if (observersToRun.length === 0) {
        return results;
      }

      logger.debug('Dispatching event', {
        type: event.type,
        observerCount: observersToRun.length,
      });

      // Build context
      const context = await this.buildContext(event);

      // Separate LLM and non-LLM observers
      const llmObservers = observersToRun.filter((o) => o.config.usesLLM);
      const nonLLMObservers = observersToRun.filter((o) => !o.config.usesLLM);

      // Run non-LLM observers in parallel
      const nonLLMResults = await Promise.all(
        nonLLMObservers.map((o) => this.runObserver(o, context))
      );
      results.push(...nonLLMResults);

      // Run LLM observers with concurrency limit
      const llmResults = await this.runWithConcurrencyLimit(
        llmObservers,
        context,
        this.config.maxConcurrentLLM
      );
      results.push(...llmResults);

      // Update stats
      this.updateStats(results);

      return results;
    } finally {
      this.isProcessing = false;

      // Process any queued events
      if (this.pendingEvents.length > 0) {
        const nextEvent = this.pendingEvents.shift()!;
        // Use setTimeout to avoid stack overflow
        setTimeout(() => this.processEvent(nextEvent), 0);
      }
    }
  }

  /**
   * Select observers that should run for an event
   */
  private selectObservers(event: ObserverEvent): Observer[] {
    const timestamp = now();

    return Array.from(this.observers.values())
      .filter((observer) => {
        // Check if observer is active in database
        const dbRecord = this.store.observerPrograms.getByType(observer.config.type);
        if (dbRecord && !dbRecord.active) {
          return false;
        }

        // Check if observer listens to this event type
        if (!observer.config.triggers.includes(event.type)) {
          return false;
        }

        // Check rate limiting
        const lastRun = this.lastRunTimes.get(observer.config.type) || 0;
        if (timestamp - lastRun < this.config.minRunInterval) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.config.priority - a.config.priority);
  }

  /**
   * Build context for observer execution
   */
  private async buildContext(event: ObserverEvent): Promise<ObserverContext> {
    const recentClaims = this.store.claims.getRecent(50);

    return {
      store: this.store,
      triggeringClaims: event.claims || [],
      recentClaims,
      sessionId: event.sessionId,
      triggeredAt: event.timestamp,
    };
  }

  /**
   * Run a single observer
   */
  private async runObserver(
    observer: Observer,
    context: ObserverContext
  ): Promise<ObserverResult> {
    const observerType = observer.config.type;

    try {
      // Check if observer should run
      if (!observer.shouldRun(context)) {
        return {
          observerType,
          hasOutput: false,
          outputs: [],
          processingTimeMs: 0,
        };
      }

      // Update last run time
      this.lastRunTimes.set(observerType, now());

      // Run the observer
      const result = await observer.run(context);

      this.stats.totalObserverRuns++;
      this.stats.observerRunsByType[observerType] =
        (this.stats.observerRunsByType[observerType] || 0) + 1;

      if (result.hasOutput) {
        logger.info('Observer produced output', {
          type: observerType,
          outputCount: result.outputs.length,
        });
      }

      return result;
    } catch (error) {
      logger.error('Observer execution failed', {
        type: observerType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        observerType,
        hasOutput: false,
        outputs: [],
        processingTimeMs: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Run observers with concurrency limit
   */
  private async runWithConcurrencyLimit(
    observers: Observer[],
    context: ObserverContext,
    limit: number
  ): Promise<ObserverResult[]> {
    const results: ObserverResult[] = [];

    for (let i = 0; i < observers.length; i += limit) {
      const batch = observers.slice(i, i + limit);
      const batchResults = await Promise.all(
        batch.map((o) => this.runObserver(o, context))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Update dispatcher stats
   */
  private updateStats(results: ObserverResult[]): void {
    if (results.length === 0) return;

    const totalTime = results.reduce((sum, r) => sum + r.processingTimeMs, 0);
    const avgTime = totalTime / results.length;

    // Rolling average
    this.stats.averageProcessingTimeMs =
      (this.stats.averageProcessingTimeMs * 0.9 + avgTime * 0.1) || avgTime;
  }

  /**
   * Get dispatcher stats
   */
  getStats(): DispatcherStats {
    return { ...this.stats };
  }

  /**
   * Get registered observer types
   */
  getRegisteredObservers(): string[] {
    return Array.from(this.observers.keys());
  }

  /**
   * Get all registered observers (for sync)
   */
  getObservers(): Map<string, Observer> {
    return this.observers;
  }

  /**
   * Manually trigger an observer
   */
  async triggerObserver(
    observerType: string,
    sessionId: string,
    claims?: Claim[]
  ): Promise<ObserverResult | null> {
    const observer = this.observers.get(observerType);
    if (!observer) {
      logger.warn('Observer not found', { observerType });
      return null;
    }

    const context = await this.buildContext({
      type: 'manual',
      claims,
      sessionId,
      timestamp: now(),
    });

    return this.runObserver(observer, context);
  }
}

/**
 * Create a dispatcher with default observers registered
 */
export function createDispatcher(
  store: ProgramStoreInstance,
  config?: Partial<DispatcherConfig>
): ObserverDispatcher {
  return new ObserverDispatcher(store, config);
}
