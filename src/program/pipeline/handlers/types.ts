/**
 * Pipeline Task Handler Types
 *
 * Defines the interface for task handlers in the event-driven pipeline.
 */

import type { TaskCheckpoint } from '../../types';
import type { IProgramStore } from '../../interfaces/store';
import type { PipelineEventBus } from '../events/eventBus';
import type { PipelineTaskType } from '../events/types';

// ============================================================================
// Task Context
// ============================================================================

/**
 * Context provided to task handlers
 */
export interface TaskContext {
  /** Access to the data store */
  store: IProgramStore;

  /** Event bus for emitting completion events */
  eventBus: PipelineEventBus;

  /** Current task ID */
  taskId: string;

  /**
   * Save a checkpoint for resumability
   * @param step - Current step identifier
   * @param data - Optional intermediate data to save
   */
  checkpoint: (step: string, data?: unknown) => Promise<void>;
}

// ============================================================================
// Task Handler Interface
// ============================================================================

/**
 * Handler for a specific pipeline task type
 *
 * Each handler is responsible for:
 * 1. Reading input data from the store
 * 2. Processing (with checkpoints for long operations)
 * 3. Saving output to the store
 * 4. Emitting completion event (AFTER save is complete)
 */
export interface PipelineTaskHandler<TPayload = unknown, TResult = unknown> {
  /**
   * Task type this handler processes
   */
  readonly taskType: PipelineTaskType;

  /**
   * Execute the task
   *
   * @param payload - Task-specific input data (parsed from payloadJson)
   * @param context - Access to store, event bus, and checkpoint function
   * @param checkpoint - Existing checkpoint if resuming (null if starting fresh)
   * @returns Result data (will be included in completion event)
   */
  execute(
    payload: TPayload,
    context: TaskContext,
    checkpoint: TaskCheckpoint | null
  ): Promise<TResult>;
}

// ============================================================================
// Handler Result Types
// ============================================================================

/**
 * Result from the preprocess_unit handler
 */
export interface PreprocessResult {
  unitId: string;
  sessionId: string;
  sanitizedText: string;
  spanIds: string[];
  correctionResult?: {
    applied: number;
    learned: number;
  };
}

/**
 * Result from the extract_primitives handler
 */
export interface ExtractPrimitivesResult {
  unitId: string;
  sessionId: string;
  propositionIds: string[];
  stanceIds: string[];
  relationIds: string[];
  /** Raw entity mentions - passed to resolve step, not stored yet */
  rawEntityMentions: Array<{
    text: string;
    mentionType: string;
    suggestedType: string;
    charStart?: number;
    charEnd?: number;
    spanId?: string;
  }>;
  llmMetadata: {
    model: string;
    tokensUsed: number;
    processingTimeMs: number;
  };
}

/**
 * Result from the resolve_and_derive handler
 */
export interface ResolveAndDeriveResult {
  unitId: string;
  sessionId: string;
  resolvedMentionIds: string[];
  newEntityIds: string[];
  claimIds: string[];
  stats: {
    matchedExisting: number;
    createdNew: number;
    pronounsResolved: number;
  };
}

/**
 * Result from observer handlers
 */
export interface ObserverResult {
  unitId: string;
  sessionId: string;
  observerType: 'nonllm' | 'llm';
  results: Array<{
    observerType: string;
    hasOutput: boolean;
    outputCount: number;
  }>;
}

// ============================================================================
// Handler Registry Type
// ============================================================================

/**
 * Registry of all pipeline handlers
 */
export type HandlerRegistry = Map<PipelineTaskType, PipelineTaskHandler>;

/**
 * Create a new handler registry
 */
export function createHandlerRegistry(): HandlerRegistry {
  return new Map();
}

/**
 * Register a handler in the registry
 */
export function registerHandler(
  registry: HandlerRegistry,
  handler: PipelineTaskHandler
): void {
  registry.set(handler.taskType, handler);
}
