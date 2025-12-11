/**
 * Observer Types
 *
 * Defines the interface for all observers in the system.
 */

import type { ObserverType, TriggerType, Claim, ObserverOutput } from '../types';
import type { ProgramStoreInstance } from '../store';

// ============================================================================
// Observer Context Types
// ============================================================================

/**
 * Context provided to observers when they run
 */
export interface ObserverContext {
  /** The store instance for data access */
  store: ProgramStoreInstance;

  /** Claims that triggered this observer (if triggered by claims) */
  triggeringClaims: Claim[];

  /** All recent claims (for context) */
  recentClaims: Claim[];

  /** Current session ID */
  sessionId: string;

  /** Timestamp when observer was triggered */
  triggeredAt: number;
}

/**
 * Result from running an observer
 */
export interface ObserverResult {
  /** Type of the observer that ran */
  observerType: ObserverType;

  /** Whether the observer produced any output */
  hasOutput: boolean;

  /** Outputs generated (saved to store) */
  outputs: ObserverOutput[];

  /** Processing time in ms */
  processingTimeMs: number;

  /** Any errors that occurred */
  error?: string;
}

// ============================================================================
// Observer Interface
// ============================================================================

/**
 * Base observer configuration
 */
export interface ObserverConfig {
  /** Unique identifier for this observer */
  type: ObserverType;

  /** Human-readable name */
  name: string;

  /** Description of what this observer does */
  description: string;

  /** What triggers this observer */
  triggers: TriggerType[];

  /** Optional: only trigger on specific claim types */
  claimTypeFilter?: string[];

  /** Priority for execution order (higher = earlier) */
  priority: number;

  /** Whether this observer uses LLM (for rate limiting) */
  usesLLM: boolean;
}

/**
 * Observer interface - all observers must implement this
 */
export interface Observer {
  /** Configuration for this observer */
  config: ObserverConfig;

  /**
   * Check if this observer should run given the context
   */
  shouldRun(context: ObserverContext): boolean | Promise<boolean>;

  /**
   * Run the observer and produce outputs
   */
  run(context: ObserverContext): Promise<ObserverResult>;
}

// ============================================================================
// Dispatcher Types
// ============================================================================

/**
 * Event that can trigger observers
 */
export interface ObserverEvent {
  type: TriggerType;
  claims?: Claim[];
  sessionId: string;
  timestamp: number;
}

/**
 * Dispatcher statistics
 */
export interface DispatcherStats {
  totalEvents: number;
  totalObserverRuns: number;
  observerRunsByType: Record<string, number>;
  averageProcessingTimeMs: number;
  lastEventTimestamp: number | null;
}
