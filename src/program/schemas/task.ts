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
  // Extraction pipeline tasks
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
  base_delay_ms: z.number().int().positive().default(1000), // 1 second
  max_delay_ms: z.number().int().positive().default(60000), // 1 minute max
  multiplier: z.number().positive().default(2), // Double each time
  jitter: z.boolean().default(true), // Add randomness to prevent thundering herd
});

/**
 * Task checkpoint - for resumable tasks
 * Stores intermediate state so we can resume from exact step
 */
export const TaskCheckpointSchema = z.object({
  step: z.string(), // Current step identifier
  step_index: z.number().int().nonnegative(), // Numeric step for ordering
  total_steps: z.number().int().positive().optional(), // Total steps if known
  intermediate_data: z.string().nullable(), // JSON serialized intermediate results
  completed_steps: z.array(z.string()), // List of completed step IDs
});

/**
 * Task schema
 */
export const TaskSchema = z.object({
  id: z.string(),
  task_type: TaskTypeSchema,
  payload_json: z.string(), // JSON serialized payload
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  priority_value: z.number().int(), // Numeric priority for sorting

  // Retry/backoff tracking
  attempts: z.number().int().nonnegative(),
  max_attempts: z.number().int().positive(),
  last_error: z.string().nullable(),
  last_error_at: z.number().nullable(),
  next_retry_at: z.number().nullable(), // When to retry (with backoff)
  backoff_config_json: z.string(), // JSON BackoffConfig

  // Checkpoint for resumability
  checkpoint_json: z.string().nullable(), // JSON TaskCheckpoint

  // Timestamps
  created_at: z.number(),
  started_at: z.number().nullable(),
  completed_at: z.number().nullable(),

  // Scheduling
  execute_at: z.number(), // Scheduled execution time (now for immediate)

  // Grouping/dependencies
  group_id: z.string().nullable(), // Group related tasks
  depends_on: z.string().nullable(), // Task ID this depends on
  session_id: z.string().nullable(), // Associated session
});

/**
 * Schema for creating a new task
 */
export const CreateTaskSchema = z.object({
  task_type: TaskTypeSchema,
  payload_json: z.string(),
  priority: TaskPrioritySchema.default('normal'),
  max_attempts: z.number().int().positive().default(5),
  backoff_config_json: z.string().optional(),
  execute_at: z.number().optional(), // Defaults to now
  group_id: z.string().nullable().optional(),
  depends_on: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
});

/**
 * Schema for updating a task
 */
export const UpdateTaskSchema = TaskSchema.partial().omit({ id: true, created_at: true });

/**
 * Calculate next retry time with exponential backoff
 */
export function calculateNextRetryTime(
  attempts: number,
  config: z.infer<typeof BackoffConfigSchema>
): number {
  const { base_delay_ms, max_delay_ms, multiplier, jitter } = config;

  // Exponential delay: base * multiplier^attempts
  let delay = base_delay_ms * Math.pow(multiplier, attempts);

  // Cap at max delay
  delay = Math.min(delay, max_delay_ms);

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
  base_delay_ms: 1000,
  max_delay_ms: 60000,
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
    step_index: 0,
    total_steps: undefined,
    intermediate_data: null,
    completed_steps: [],
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
    step_index: current.step_index + 1,
    intermediate_data: intermediateData ? JSON.stringify(intermediateData) : null,
    completed_steps: [...current.completed_steps, current.step],
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
      relevance_score: z.number(),
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
  if (task.attempts >= task.max_attempts) {
    return false;
  }

  // Check if it's time to retry
  if (task.next_retry_at && Date.now() < task.next_retry_at) {
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

  if (!task.started_at) {
    return false;
  }

  return Date.now() - task.started_at > staleThresholdMs;
}
