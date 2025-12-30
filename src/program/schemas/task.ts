/**
 * Task Queue Schema
 *
 * Durable task queue for ALL operations - both real-time and background.
 * Tasks are persisted to IndexedDB via TinyBase, enabling:
 * - Recovery after browser reload
 * - Retry on API failures with exponential backoff
 * - Resumption from exact step where failure occurred
 */

import { z } from 'zod';

/**
 * Task type - what kind of task to execute
 */
export const TaskTypeSchema = z.enum([
  // Queue-based pipeline (simple sequential processing)
  'process_unit',          // Full unit processing (preprocess → extract → resolve → derive)

  // Legacy event-driven pipeline tasks (deprecated)
  'preprocess_unit',       // JS only: sanitize + corrections + spans
  'extract_primitives',    // LLM: single extraction call
  'resolve_and_derive',    // JS only: entity resolution + claim derivation
  'run_nonllm_observers',  // JS only: batched non-LLM observers
  'run_llm_observers',     // LLM: batched LLM observers
  'run_decay',             // Background: memory decay

  // Legacy extraction pipeline tasks (deprecated, kept for compatibility)
  'extract_from_unit',
  'run_extractor', // Single extractor run
  'save_extraction_results',

  // Observer tasks
  'run_observer',

  // Memory/consolidation tasks
  'consolidate_memory',
  'check_chain_dormancy',
  'generate_session_summary',
  'decay_claims',

  // Goal tasks
  'check_goal_progress',
  'infer_goal_hierarchy',

  // Synthesis tasks
  'generate_synthesis',

  // Chain management
  'process_chain_updates',
]);

/**
 * Task status
 */
export const TaskStatusSchema = z.enum([
  'pending', // Waiting to be processed
  'processing', // Currently being processed
  'completed', // Successfully completed
  'failed', // Failed after max retries
  'paused', // Manually paused
]);

/**
 * Task priority levels
 */
export const TaskPrioritySchema = z.enum([
  'critical', // User-facing, immediate (e.g., real-time extraction)
  'high', // Important but can wait briefly
  'normal', // Standard background processing
  'low', // Can be deferred (e.g., daily tasks)
]);

export const PRIORITY_VALUES: Record<z.infer<typeof TaskPrioritySchema>, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
};

/**
 * Backoff configuration
 */
export const BackoffConfigSchema = z.object({
  baseDelayMs: z.number().int().positive().default(1000), // 1 second
  maxDelayMs: z.number().int().positive().default(60000), // 1 minute max
  multiplier: z.number().positive().default(2), // Double each time
  jitter: z.boolean().default(true), // Add randomness to prevent thundering herd
});

/**
 * Task checkpoint - for resumable tasks
 * Stores intermediate state so we can resume from exact step
 */
export const TaskCheckpointSchema = z.object({
  step: z.string(), // Current step identifier
  stepIndex: z.number().int().nonnegative(), // Numeric step for ordering
  totalSteps: z.number().int().positive().optional(), // Total steps if known
  intermediateData: z.string().nullable(), // JSON serialized intermediate results
  completedSteps: z.array(z.string()), // List of completed step IDs
});

/**
 * Task schema
 */
export const TaskSchema = z.object({
  id: z.string(),
  taskType: TaskTypeSchema,
  payloadJson: z.string(), // JSON serialized payload
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  priorityValue: z.number().int(), // Numeric priority for sorting

  // Retry/backoff tracking
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().nullable(),
  lastErrorAt: z.number().nullable(),
  nextRetryAt: z.number().nullable(), // When to retry (with backoff)
  backoffConfigJson: z.string(), // JSON BackoffConfig

  // Checkpoint for resumability
  checkpointJson: z.string().nullable(), // JSON TaskCheckpoint

  // Timestamps
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),

  // Scheduling
  executeAt: z.number(), // Scheduled execution time (now for immediate)

  // Grouping/dependencies
  groupId: z.string().nullable(), // Group related tasks
  dependsOn: z.string().nullable(), // Task ID this depends on
  sessionId: z.string().nullable(), // Associated session
});

/**
 * Schema for creating a new task
 */
export const CreateTaskSchema = z.object({
  taskType: TaskTypeSchema,
  payloadJson: z.string(),
  priority: TaskPrioritySchema.default('normal'),
  maxAttempts: z.number().int().positive().default(5),
  backoffConfigJson: z.string().optional(),
  executeAt: z.number().optional(), // Defaults to now
  groupId: z.string().nullable().optional(),
  dependsOn: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
});

/**
 * Schema for updating a task
 */
export const UpdateTaskSchema = TaskSchema.partial().omit({ id: true, createdAt: true });

/**
 * Calculate next retry time with exponential backoff
 */
export function calculateNextRetryTime(
  attempts: number,
  config: z.infer<typeof BackoffConfigSchema>
): number {
  const { baseDelayMs, maxDelayMs, multiplier, jitter } = config;

  // Exponential delay: base * multiplier^attempts
  let delay = baseDelayMs * Math.pow(multiplier, attempts);

  // Cap at max delay
  delay = Math.min(delay, maxDelayMs);

  // Add jitter (0-25% random variation)
  if (jitter) {
    const jitterAmount = delay * 0.25 * Math.random();
    delay = delay + jitterAmount;
  }

  return Date.now() + Math.floor(delay);
}

/**
 * Default backoff configuration
 */
export const DEFAULT_BACKOFF_CONFIG: z.infer<typeof BackoffConfigSchema> = {
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  multiplier: 2,
  jitter: true,
};

/**
 * Parse backoff config from JSON
 */
export function parseBackoffConfig(json: string): z.infer<typeof BackoffConfigSchema> {
  try {
    return BackoffConfigSchema.parse(JSON.parse(json));
  } catch {
    return DEFAULT_BACKOFF_CONFIG;
  }
}

/**
 * Serialize backoff config to JSON
 */
export function serializeBackoffConfig(config: z.infer<typeof BackoffConfigSchema>): string {
  return JSON.stringify(config);
}

/**
 * Parse checkpoint from JSON
 */
export function parseCheckpoint(json: string | null): z.infer<typeof TaskCheckpointSchema> | null {
  if (!json) return null;
  try {
    return TaskCheckpointSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * Serialize checkpoint to JSON
 */
export function serializeCheckpoint(checkpoint: z.infer<typeof TaskCheckpointSchema>): string {
  return JSON.stringify(checkpoint);
}

/**
 * Create initial checkpoint
 */
export function createInitialCheckpoint(firstStep: string): z.infer<typeof TaskCheckpointSchema> {
  return {
    step: firstStep,
    stepIndex: 0,
    totalSteps: undefined,
    intermediateData: null,
    completedSteps: [],
  };
}

/**
 * Advance checkpoint to next step
 */
export function advanceCheckpoint(
  current: z.infer<typeof TaskCheckpointSchema>,
  nextStep: string,
  intermediateData?: unknown
): z.infer<typeof TaskCheckpointSchema> {
  return {
    ...current,
    step: nextStep,
    stepIndex: current.stepIndex + 1,
    intermediateData: intermediateData ? JSON.stringify(intermediateData) : null,
    completedSteps: [...current.completedSteps, current.step],
  };
}

// ============================================================================
// Payload schemas for each task type
// ============================================================================

export const ExtractFromUnitPayloadSchema = z.object({
  unitId: z.string(),
  extractorIds: z.array(z.string()).optional(), // Specific extractors, or all if omitted
});

export const RunExtractorPayloadSchema = z.object({
  unitId: z.string(),
  extractorId: z.string(),
  matches: z.array(
    z.object({
      text: z.string(),
      position: z.object({ start: z.number(), end: z.number() }),
      context: z.string(),
      relevanceScore: z.number(),
    })
  ),
});

export const SaveExtractionResultsPayloadSchema = z.object({
  unitId: z.string(),
  extractorId: z.string(),
  results: z.unknown(), // Varies by extractor
});

export const RunObserverPayloadSchema = z.object({
  observerId: z.string(),
  context: z.object({
    trigger: z.object({
      type: z.string(),
      pattern: z.string().optional(),
      claimType: z.string().optional(),
    }),
    newClaimIds: z.array(z.string()).optional(),
    sessionId: z.string().nullable(),
    timestamp: z.number(),
  }),
});

export const ConsolidateMemoryPayloadSchema = z.object({
  sessionId: z.string(),
});

export const CheckChainDormancyPayloadSchema = z.object({
  chainId: z.string(),
});

export const GenerateSessionSummaryPayloadSchema = z.object({
  sessionId: z.string(),
});

export const DecayClaimsPayloadSchema = z.object({
  // Empty - processes all claims
});

export const CheckGoalProgressPayloadSchema = z.object({
  goalId: z.string(),
});

export const InferGoalHierarchyPayloadSchema = z.object({
  goalId: z.string(),
});

export const GenerateSynthesisPayloadSchema = z.object({
  synthesisType: z.string(),
  params: z.record(z.string(), z.unknown()),
});

export const ProcessChainUpdatesPayloadSchema = z.object({
  unitId: z.string(),
  claimIds: z.array(z.string()),
});

/**
 * Helper to parse task payload with type safety
 */
export function parseTaskPayload<T>(json: string, schema: z.ZodSchema<T>): T {
  return schema.parse(JSON.parse(json));
}

/**
 * Helper to serialize task payload
 */
export function serializeTaskPayload(payload: unknown): string {
  return JSON.stringify(payload);
}

/**
 * Check if a task should be retried
 */
export function shouldRetryTask(task: z.infer<typeof TaskSchema>): boolean {
  if (task.status !== 'failed' && task.status !== 'processing') {
    return false;
  }

  // Check if we've exceeded max attempts
  if (task.attempts >= task.maxAttempts) {
    return false;
  }

  // Check if it's time to retry
  if (task.nextRetryAt && Date.now() < task.nextRetryAt) {
    return false;
  }

  return true;
}

/**
 * Check if task is stale (stuck in processing)
 */
export function isStaleTask(task: z.infer<typeof TaskSchema>, staleThresholdMs: number): boolean {
  if (task.status !== 'processing') {
    return false;
  }

  if (!task.startedAt) {
    return false;
  }

  return Date.now() - task.startedAt > staleThresholdMs;
}
