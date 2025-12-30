/**
 * Pipeline Event Loop
 *
 * Event-driven durable task executor. Coordinates task execution
 * based on events, with full durability through DB persistence.
 *
 * Key features:
 * - Event-driven: Tasks trigger next task via events
 * - Durable: All state persisted to DB
 * - Recoverable: Resume from last completed step on reload
 * - Retry with backoff: Failed tasks retry with exponential backoff
 */

import type { Subscription } from 'rxjs';
import type { Task, TaskCheckpoint } from '../types';
import type { IProgramStore } from '../interfaces/store';
import {
  PipelineEventBus,
  getEventBus,
} from './events/eventBus';
import type {
  PipelineTaskType,
  UnitCreatedPayload,
  UnitPreprocessedPayload,
  PrimitivesExtractedPayload,
  ClaimsDerivedPayload,
  ObserversCompletedPayload,
} from './events/types';
import type { PipelineTaskHandler, TaskContext } from './handlers/types';
import { calculateNextRetryTime, parseBackoffConfig, parseCheckpoint, serializeCheckpoint } from '../schemas/task';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('EventLoop');

// ============================================================================
// Configuration
// ============================================================================

export interface EventLoopConfig {
  /** Maximum concurrent tasks */
  maxConcurrent: number;
  /** How often to poll for retryable tasks (ms) */
  pollInterval: number;
  /** After how long is a running task considered stale (ms) */
  staleThreshold: number;
  /** Whether to automatically start processing */
  autoStart: boolean;
}

const DEFAULT_CONFIG: EventLoopConfig = {
  maxConcurrent: 3,
  pollInterval: 1000,
  staleThreshold: 30000, // 30 seconds
  autoStart: false,
};

// ============================================================================
// Event Loop Implementation
// ============================================================================

export class PipelineEventLoop {
  private store: IProgramStore;
  private eventBus: PipelineEventBus;
  private handlers: Map<PipelineTaskType, PipelineTaskHandler> = new Map();
  private config: EventLoopConfig;
  private isRunning = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeTasks: Set<string> = new Set();
  private subscriptions: Subscription[] = [];
  private hasRunRecovery = false;

  constructor(store: IProgramStore, config?: Partial<EventLoopConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventBus = getEventBus();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the event loop
   */
  async initialize(): Promise<void> {
    logger.info('Initializing event loop...');

    // Set up event handlers (wiring)
    this.setupEventHandlers();

    // Recover from any previous incomplete work
    await this.recover();

    if (this.config.autoStart) {
      this.start();
    }

    logger.info('Event loop initialized');
  }

  /**
   * Start processing tasks
   */
  start(): void {
    if (this.isRunning) {
      logger.debug('Event loop already running');
      return;
    }

    this.isRunning = true;
    logger.info('Event loop started');

    // Start polling for retryable tasks
    this.pollTimer = setInterval(() => this.pollRetryable(), this.config.pollInterval);

    // Process any pending tasks immediately
    this.processQueue();
  }

  /**
   * Stop processing tasks
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    logger.info('Event loop stopped');
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    this.stop();

    // Unsubscribe from all events
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];

    logger.info('Event loop shutdown complete');
  }

  // ==========================================================================
  // Handler Registration
  // ==========================================================================

  /**
   * Register a task handler
   */
  registerHandler(handler: PipelineTaskHandler): void {
    this.handlers.set(handler.taskType, handler);
    logger.debug('Registered handler', { taskType: handler.taskType });
  }

  /**
   * Check if a handler is registered for a task type
   */
  hasHandler(taskType: PipelineTaskType): boolean {
    return this.handlers.has(taskType);
  }

  // ==========================================================================
  // Event Wiring
  // ==========================================================================

  /**
   * Wire up event → task mappings
   * Dependencies are defined HERE IN CODE, not in task metadata
   *
   * IMPORTANT: Each handler checks for existing tasks before creating new ones
   * to prevent duplicate LLM calls which cost money.
   */
  private setupEventHandlers(): void {
    // Prevent double setup
    if (this.subscriptions.length > 0) {
      logger.warn('Event handlers already set up, skipping');
      return;
    }

    // unit:created → preprocess_unit
    this.subscriptions.push(
      this.eventBus.on<UnitCreatedPayload>('unit:created').subscribe(async (event) => {
        await this.createTaskIfNotExists('preprocess_unit', event.payload, 'critical');
      })
    );

    // unit:preprocessed → extract_primitives
    this.subscriptions.push(
      this.eventBus.on<UnitPreprocessedPayload>('unit:preprocessed').subscribe(async (event) => {
        await this.createTaskIfNotExists('extract_primitives', event.payload, 'high');
      })
    );

    // primitives:extracted → resolve_and_derive
    this.subscriptions.push(
      this.eventBus.on<PrimitivesExtractedPayload>('primitives:extracted').subscribe(async (event) => {
        await this.createTaskIfNotExists('resolve_and_derive', event.payload, 'high');
      })
    );

    // claims:derived → run_nonllm_observers
    this.subscriptions.push(
      this.eventBus.on<ClaimsDerivedPayload>('claims:derived').subscribe(async (event) => {
        await this.createTaskIfNotExists('run_nonllm_observers', event.payload, 'normal');
      })
    );

    // observers:nonllm:completed → run_llm_observers
    this.subscriptions.push(
      this.eventBus.on<ObserversCompletedPayload>('observers:nonllm:completed').subscribe(async (event) => {
        await this.createTaskIfNotExists('run_llm_observers', event.payload, 'normal');
      })
    );

    // observers:llm:completed → mark unit complete
    this.subscriptions.push(
      this.eventBus.on<ObserversCompletedPayload>('observers:llm:completed').subscribe(async (event) => {
        await this.completeUnit(event.payload.unitId, event.payload.sessionId);
      })
    );

    logger.info('Event handlers set up');
  }

  // ==========================================================================
  // Task Management
  // ==========================================================================

  /**
   * Create a task ONLY if one doesn't already exist for this unit + task type.
   * This is the PRIMARY method to use for event handlers to prevent duplicate LLM calls.
   *
   * Returns: task ID (existing or new), or null if unit not found in payload
   */
  async createTaskIfNotExists<T extends { unitId?: string; sessionId?: string }>(
    taskType: PipelineTaskType,
    payload: T,
    priority: 'critical' | 'high' | 'normal' | 'low' = 'normal'
  ): Promise<string | null> {
    const unitId = payload.unitId;

    // Without unitId, we can't deduplicate - log warning and create anyway
    if (!unitId) {
      logger.warn('createTaskIfNotExists called without unitId, creating task anyway', { taskType });
      return this.createTask(taskType, payload, priority);
    }

    // Check if task already exists for this unit + type
    const existingTask = await this.findExistingTaskForUnit(unitId, taskType);

    if (existingTask) {
      // Already have a task for this, skip creation
      logger.debug('Task already exists for unit, skipping', {
        existingTaskId: existingTask.id,
        type: taskType,
        unitId,
        status: existingTask.status,
      });
      return existingTask.id;
    }

    // No existing task, create new one
    return this.createTask(taskType, payload, priority);
  }

  /**
   * Find an existing task for a unit + task type
   * Returns task if found (any status except 'completed'), null otherwise
   */
  private async findExistingTaskForUnit(
    unitId: string,
    taskType: PipelineTaskType
  ): Promise<Task | null> {
    const allTasks = await this.store.tasks.getAll();

    for (const task of allTasks) {
      // Skip completed tasks - they don't block new tasks
      if (task.status === 'completed') continue;

      // Check task type matches
      if (task.taskType !== taskType) continue;

      // Check unitId in payload
      try {
        const payload = JSON.parse(task.payloadJson);
        if (payload.unitId === unitId) {
          return task;
        }
      } catch {
        // Invalid JSON, skip
      }
    }

    return null;
  }

  /**
   * Create and queue a new task
   * NOTE: Prefer createTaskIfNotExists for event handlers to prevent duplicates
   */
  async createTask(
    taskType: PipelineTaskType,
    payload: unknown,
    priority: 'critical' | 'high' | 'normal' | 'low' = 'normal'
  ): Promise<string> {
    const task = await this.store.tasks.create({
      taskType,
      payloadJson: JSON.stringify(payload),
      priority,
      maxAttempts: 3,
    });

    logger.info('Created task', {
      id: task.id,
      type: taskType,
      priority,
    });

    // Immediately try to process if we have capacity
    this.processQueue();

    return task.id;
  }

  /**
   * Poll for and process pending tasks
   */
  private async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    // Don't exceed max concurrent
    if (this.activeTasks.size >= this.config.maxConcurrent) return;

    // Get pending tasks
    const pending = await this.store.tasks.getPending();

    // Filter to tasks we have handlers for
    const available = pending
      .filter((t) => !this.activeTasks.has(t.id))
      .filter((t) => this.handlers.has(t.taskType as PipelineTaskType))
      .sort((a, b) => b.priorityValue - a.priorityValue);

    // Process up to maxConcurrent - active
    const slotsAvailable = this.config.maxConcurrent - this.activeTasks.size;
    const toProcess = available.slice(0, slotsAvailable);

    for (const task of toProcess) {
      this.executeTask(task).catch((error) => {
        logger.error('Task processing failed unexpectedly', {
          taskId: task.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }
  }

  /**
   * Poll for retryable tasks (failed but under max attempts)
   */
  private async pollRetryable(): Promise<void> {
    if (!this.isRunning) return;
    if (this.activeTasks.size >= this.config.maxConcurrent) return;

    const retryable = await this.store.tasks.getRetryable();
    const toRetry = retryable
      .filter((t) => !this.activeTasks.has(t.id))
      .filter((t) => this.handlers.has(t.taskType as PipelineTaskType));

    for (const task of toRetry) {
      // Check if it's time to retry
      if (task.nextRetryAt && now() < task.nextRetryAt) continue;

      this.executeTask(task).catch((error) => {
        logger.error('Retry failed', {
          taskId: task.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }
  }

  /**
   * Execute a single task
   */
  private async executeTask(task: Task): Promise<void> {
    const taskId = task.id;

    // Mark as active
    this.activeTasks.add(taskId);

    try {
      // Get handler
      const handler = this.handlers.get(task.taskType as PipelineTaskType);
      if (!handler) {
        throw new Error(`No handler registered for task type: ${task.taskType}`);
      }

      // Update status to processing
      await this.store.tasks.update(taskId, {
        status: 'processing',
        startedAt: now(),
        attempts: task.attempts + 1,
      });

      logger.info('Processing task', {
        id: taskId,
        type: task.taskType,
        attempt: task.attempts + 1,
      });

      // Parse payload and checkpoint
      const payload = JSON.parse(task.payloadJson);
      const checkpoint = parseCheckpoint(task.checkpointJson);

      // Build task context
      const context: TaskContext = {
        store: this.store,
        eventBus: this.eventBus,
        taskId,
        checkpoint: async (step: string, data?: unknown) => {
          await this.updateCheckpoint(taskId, step, data);
        },
      };

      // Execute handler - it will emit completion event
      await handler.execute(payload, context, checkpoint);

      // Mark as completed
      await this.store.tasks.update(taskId, {
        status: 'completed',
        completedAt: now(),
        checkpointJson: null, // Clear checkpoint on success
      });

      logger.info('Task completed', { id: taskId, type: task.taskType });
    } catch (error) {
      await this.handleTaskError(task, error);
    } finally {
      this.activeTasks.delete(taskId);

      // Check for more work
      this.processQueue();
    }
  }

  /**
   * Handle task failure with retry logic
   */
  private async handleTaskError(task: Task, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.warn('Task failed', {
      id: task.id,
      type: task.taskType,
      attempt: task.attempts + 1,
      error: errorMessage,
    });

    // Calculate next retry time with exponential backoff
    const backoffConfig = parseBackoffConfig(task.backoffConfigJson);
    const nextRetryAt = calculateNextRetryTime(task.attempts + 1, backoffConfig);

    // Check if we've exceeded max attempts
    const newAttempts = task.attempts + 1;
    const isFailed = newAttempts >= task.maxAttempts;

    await this.store.tasks.update(task.id, {
      status: isFailed ? 'failed' : 'pending', // Return to pending for retry
      lastError: errorMessage,
      lastErrorAt: now(),
      nextRetryAt: isFailed ? null : nextRetryAt,
      attempts: newAttempts,
    });

    if (isFailed) {
      logger.error('Task permanently failed', {
        id: task.id,
        type: task.taskType,
        attempts: newAttempts,
      });
    }
  }

  /**
   * Update checkpoint for a running task
   */
  private async updateCheckpoint(taskId: string, step: string, data?: unknown): Promise<void> {
    const checkpoint: TaskCheckpoint = {
      step,
      stepIndex: 0,
      totalSteps: undefined,
      intermediateData: data ? JSON.stringify(data) : null,
      completedSteps: [],
    };

    await this.store.tasks.update(taskId, {
      checkpointJson: serializeCheckpoint(checkpoint),
    });

    logger.debug('Updated checkpoint', { taskId, step });
  }

  // ==========================================================================
  // Unit Completion
  // ==========================================================================

  /**
   * Mark a unit as fully processed
   */
  private async completeUnit(unitId: string, sessionId: string): Promise<void> {
    logger.info('Completing unit', { unitId });

    // Mark conversation as processed
    await this.store.conversations.markProcessed(unitId);

    // Emit completion event
    this.eventBus.emit('unit:completed', unitId, {
      unitId,
      sessionId,
      totalProcessingTimeMs: 0, // TODO: Calculate from task timestamps
      summary: {
        claims: 0, // TODO: Query counts
        entities: 0,
        observerOutputs: 0,
      },
    });
  }

  // ==========================================================================
  // Recovery
  // ==========================================================================

  /**
   * Recover from browser reload or crash
   */
  async recover(): Promise<void> {
    if (this.hasRunRecovery) return;
    this.hasRunRecovery = true;

    logger.info('Running recovery...');

    // 1. Recover stale tasks (stuck in processing)
    await this.recoverStaleTasks();

    // 2. Recover incomplete units
    await this.recoverIncompleteUnits();

    logger.info('Recovery complete');
  }

  /**
   * Recover tasks stuck in processing state
   */
  private async recoverStaleTasks(): Promise<void> {
    const processingTasks = await this.store.tasks.getByStatus('processing');
    const timestamp = now();
    let recovered = 0;

    for (const task of processingTasks) {
      const age = task.startedAt ? timestamp - task.startedAt : 0;

      // Consider stale if processing for longer than threshold
      if (age > this.config.staleThreshold) {
        const backoffConfig = parseBackoffConfig(task.backoffConfigJson);
        const nextRetryAt = calculateNextRetryTime(task.attempts, backoffConfig);

        await this.store.tasks.update(task.id, {
          status: 'pending',
          nextRetryAt,
          lastError: 'Task stale - recovered after browser reload',
          lastErrorAt: timestamp,
        });

        logger.info('Recovered stale task', { id: task.id, age });
        recovered++;
      }
    }

    if (recovered > 0) {
      logger.info('Recovered stale tasks', { count: recovered });
    }
  }

  /**
   * Recover incomplete conversation units
   * Creates tasks for units that didn't complete processing
   */
  private async recoverIncompleteUnits(): Promise<void> {
    const allUnits = await this.store.conversations.getAll();
    const unprocessed = allUnits.filter((u) => !u.processed);
    let recovered = 0;

    for (const unit of unprocessed) {
      // Determine what stage the unit is at
      const nextTask = await this.determineRecoveryTask(unit.id);

      if (nextTask) {
        // Check if there's already a pending/processing task for this unit
        const existingTasks = await this.findTasksForUnit(unit.id);
        const hasPendingTask = existingTasks.some(
          (t) => t.status === 'pending' || t.status === 'processing'
        );

        if (!hasPendingTask) {
          await this.createTask(nextTask, {
            unitId: unit.id,
            sessionId: unit.sessionId,
          });
          recovered++;
        }
      }
    }

    if (recovered > 0) {
      logger.info('Recovered incomplete units', { count: recovered });
    }
  }

  /**
   * Determine which task to run next for a unit based on what data exists
   */
  private async determineRecoveryTask(unitId: string): Promise<PipelineTaskType | null> {
    // Check what data exists for this unit, in reverse order of pipeline

    // Check if claims exist (via claim sources table)
    const claimSources = await this.store.claims.getSourcesForUnit(unitId);
    if (claimSources.length > 0) {
      // Claims exist, check if observers ran
      // For now, assume we need to run observers
      return 'run_nonllm_observers';
    }

    // Check if primitives exist
    const propositions = await this.store.propositions.getByConversation(unitId);
    if (propositions.length > 0) {
      return 'resolve_and_derive';
    }

    // Check if spans exist
    const spans = await this.store.spans.getByConversation(unitId);
    if (spans.length > 0) {
      return 'extract_primitives';
    }

    // Nothing exists yet, start from preprocessing
    return 'preprocess_unit';
  }

  /**
   * Find all tasks associated with a unit
   */
  private async findTasksForUnit(unitId: string): Promise<Task[]> {
    const allTasks = await this.store.tasks.getAll();
    return allTasks.filter((t) => {
      try {
        const payload = JSON.parse(t.payloadJson);
        return payload.unitId === unitId;
      } catch {
        return false;
      }
    });
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  /**
   * Get event loop status
   */
  async getStatus(): Promise<{
    isRunning: boolean;
    activeTasks: number;
    pendingTasks: number;
    failedTasks: number;
  }> {
    const pendingTasks = await this.store.tasks.getByStatus('pending');
    const failedTasks = await this.store.tasks.getByStatus('failed');

    return {
      isRunning: this.isRunning,
      activeTasks: this.activeTasks.size,
      pendingTasks: pendingTasks.length,
      failedTasks: failedTasks.length,
    };
  }

  /**
   * Get the event bus instance
   */
  getEventBus(): PipelineEventBus {
    return this.eventBus;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new event loop instance
 */
export function createEventLoop(
  store: IProgramStore,
  config?: Partial<EventLoopConfig>
): PipelineEventLoop {
  return new PipelineEventLoop(store, config);
}
