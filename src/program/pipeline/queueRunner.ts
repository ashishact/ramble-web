/**
 * Queue Runner
 *
 * Durable task queue runner that processes tasks with:
 * - Checkpoint-based resumability
 * - Exponential backoff on failures
 * - Recovery from browser reloads
 * - Priority-based processing
 */

import type { Task, CreateTask, TaskCheckpoint } from '../types';
import type { ProgramStoreInstance } from '../store/programStore';
import { calculateNextRetryTime, parseBackoffConfig, parseCheckpoint, serializeCheckpoint } from '../schemas/task';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('Queue');

// ============================================================================
// Types
// ============================================================================

export interface TaskHandler<TPayload = unknown, TResult = unknown> {
  /** Handle the task, optionally resuming from checkpoint */
  execute(payload: TPayload, checkpoint: TaskCheckpoint | null): Promise<TResult>;

  /** Optional: Save intermediate progress */
  createCheckpoint?(step: string, stepIndex: number, data: unknown): TaskCheckpoint;
}

export interface QueueRunnerConfig {
  /** Maximum concurrent tasks */
  maxConcurrent: number;
  /** How often to poll for new tasks (ms) */
  pollInterval: number;
  /** After how long is a running task considered stale (ms) */
  staleThreshold: number;
  /** Whether to automatically start processing */
  autoStart: boolean;
}

const DEFAULT_CONFIG: QueueRunnerConfig = {
  maxConcurrent: 3,
  pollInterval: 1000,
  staleThreshold: 60000, // 1 minute
  autoStart: false,
};

// ============================================================================
// Queue Runner Implementation
// ============================================================================

export class QueueRunner {
  private store: ProgramStoreInstance;
  private handlers: Map<string, TaskHandler> = new Map();
  private config: QueueRunnerConfig;
  private isRunning = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeTasks: Set<string> = new Set();

  constructor(store: ProgramStoreInstance, config?: Partial<QueueRunnerConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * Register a handler for a task type
   */
  registerHandler<TPayload = unknown, TResult = unknown>(
    taskType: string,
    handler: TaskHandler<TPayload, TResult>
  ): void {
    this.handlers.set(taskType, handler as TaskHandler);
    logger.debug('Registered handler', { taskType });
  }

  /**
   * Start the queue runner
   */
  start(): void {
    if (this.isRunning) {
      console.log('[Queue] Already running, skipping start');
      return;
    }

    this.isRunning = true;
    console.log('[Queue] Queue runner starting...');
    logger.info('Queue runner started');

    // Recover any stale tasks from previous session
    this.recoverStaleTasks();

    // Start polling for tasks
    console.log('[Queue] Starting poll loop with interval:', this.config.pollInterval, 'ms');
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.config.pollInterval);
  }

  /**
   * Stop the queue runner
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Queue runner stopped');
  }

  /**
   * Enqueue a new task
   */
  async enqueue(data: CreateTask): Promise<string> {
    const task = this.store.tasks.create(data);
    logger.debug('Enqueued task', { id: task.id, type: task.task_type });
    return task.id;
  }

  /**
   * Poll for and process tasks
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    // Don't exceed max concurrent
    if (this.activeTasks.size >= this.config.maxConcurrent) return;

    // Get pending and retryable tasks
    const pending = this.store.tasks.getPending();
    const retryable = this.store.tasks.getRetryable();

    if (pending.length > 0 || retryable.length > 0) {
      console.log('[Queue] Poll: pending:', pending.length, 'retryable:', retryable.length, 'active:', this.activeTasks.size);
    }

    // Combine and sort by priority
    const available = [...pending, ...retryable]
      .filter((t) => !this.activeTasks.has(t.id))
      .sort((a, b) => b.priority_value - a.priority_value);

    // Process up to maxConcurrent - active
    const slotsAvailable = this.config.maxConcurrent - this.activeTasks.size;
    const toProcess = available.slice(0, slotsAvailable);

    for (const task of toProcess) {
      this.processTask(task).catch((error) => {
        logger.error('Task processing failed unexpectedly', {
          taskId: task.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }
  }

  /**
   * Process a single task
   */
  private async processTask(task: Task): Promise<void> {
    const taskId = task.id;

    // Mark as active
    this.activeTasks.add(taskId);

    try {
      // Get handler
      const handler = this.handlers.get(task.task_type);
      if (!handler) {
        throw new Error(`No handler registered for task type: ${task.task_type}`);
      }

      // Update status to processing
      this.store.tasks.update(taskId, {
        status: 'processing',
        started_at: now(),
        attempts: task.attempts + 1,
      });

      logger.info('Processing task', {
        id: taskId,
        type: task.task_type,
        attempt: task.attempts + 1,
      });

      // Parse payload and checkpoint
      const payload = JSON.parse(task.payload_json);
      const checkpoint = parseCheckpoint(task.checkpoint_json);

      // Execute handler
      await handler.execute(payload, checkpoint);

      // Mark as completed
      this.store.tasks.update(taskId, {
        status: 'completed',
        completed_at: now(),
        checkpoint_json: null, // Clear checkpoint on success
      });

      logger.info('Task completed', { id: taskId, type: task.task_type });
    } catch (error) {
      await this.handleTaskError(task, error);
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  /**
   * Handle task failure
   */
  private async handleTaskError(task: Task, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.warn('Task failed', {
      id: task.id,
      type: task.task_type,
      attempt: task.attempts + 1,
      error: errorMessage,
    });

    // Calculate next retry time with exponential backoff
    const backoffConfig = parseBackoffConfig(task.backoff_config_json);
    const nextRetryAt = calculateNextRetryTime(task.attempts + 1, backoffConfig);

    // Check if we've exceeded max attempts
    const newAttempts = task.attempts + 1;
    const isFailed = newAttempts >= task.max_attempts;

    this.store.tasks.update(task.id, {
      status: isFailed ? 'failed' : 'pending', // Return to pending for retry
      last_error: errorMessage,
      last_error_at: now(),
      next_retry_at: isFailed ? null : nextRetryAt,
      attempts: newAttempts,
    });

    if (isFailed) {
      logger.error('Task permanently failed', {
        id: task.id,
        type: task.task_type,
        attempts: newAttempts,
      });
    }
  }

  /**
   * Recover tasks that were running when the browser closed
   */
  private recoverStaleTasks(): void {
    const processingTasks = this.store.tasks.getByStatus('processing');
    const timestamp = now();
    let recovered = 0;

    console.log('[Queue] Checking for stale tasks. Processing tasks:', processingTasks.length);

    for (const task of processingTasks) {
      const age = task.started_at ? timestamp - task.started_at : 0;
      console.log('[Queue] Task', task.id.slice(0, 8), 'age:', age, 'ms, threshold:', this.config.staleThreshold);

      // Recover any task that's been processing (browser was closed mid-task)
      // Use a shorter threshold on startup - if it's processing and we just loaded, it's stale
      const isStale = task.started_at && age > 5000; // 5 seconds is enough to know it's stuck

      if (isStale) {
        // Reset to pending for retry
        const backoffConfig = parseBackoffConfig(task.backoff_config_json);
        const nextRetryAt = calculateNextRetryTime(task.attempts, backoffConfig);

        this.store.tasks.update(task.id, {
          status: 'pending',
          next_retry_at: nextRetryAt,
          last_error: 'Task stale - recovered after browser reload',
          last_error_at: timestamp,
        });

        console.log('[Queue] Recovered stale task:', task.id.slice(0, 8));
        recovered++;
      }
    }

    if (recovered > 0) {
      logger.info('Recovered stale tasks', { count: recovered });
    }
  }

  /**
   * Update checkpoint for a running task
   */
  updateCheckpoint(taskId: string, checkpoint: TaskCheckpoint): void {
    this.store.tasks.update(taskId, {
      checkpoint_json: serializeCheckpoint(checkpoint),
    });

    logger.debug('Updated checkpoint', {
      taskId,
      step: checkpoint.step,
      stepIndex: checkpoint.step_index,
    });
  }

  /**
   * Get queue status
   */
  getStatus(): {
    isRunning: boolean;
    activeTasks: number;
    pendingTasks: number;
    failedTasks: number;
  } {
    const pending = this.store.tasks.getByStatus('pending').length;
    const failed = this.store.tasks.getByStatus('failed').length;

    return {
      isRunning: this.isRunning,
      activeTasks: this.activeTasks.size,
      pendingTasks: pending,
      failedTasks: failed,
    };
  }
}

/**
 * Create a queue runner instance
 */
export function createQueueRunner(
  store: ProgramStoreInstance,
  config?: Partial<QueueRunnerConfig>
): QueueRunner {
  return new QueueRunner(store, config);
}
