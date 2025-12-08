/**
 * Queue Interface
 *
 * Abstract interface for the durable task queue.
 * Supports resumable operations with checkpoints and exponential backoff.
 */

import type {
  Task,
  CreateTask,
  UpdateTask,
  TaskStatus,
  TaskCheckpoint,
  TaskType,
} from '../types';

/**
 * Result of processing a task
 */
export interface TaskProcessResult {
  taskId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
  checkpoint?: TaskCheckpoint;
}

/**
 * Queue status information
 */
export interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalTasks: number;
  isProcessing: boolean;
  currentTask: Task | null;
}

/**
 * Queue event callbacks
 */
export interface IQueueCallbacks {
  onTaskStarted?: (task: Task) => void;
  onTaskCompleted?: (task: Task, result: TaskProcessResult) => void;
  onTaskFailed?: (task: Task, error: Error) => void;
  onTaskRetrying?: (task: Task, attempt: number, nextRetryAt: number) => void;
  onQueueEmpty?: () => void;
  onStatusChange?: (status: QueueStatus) => void;
}

/**
 * Task executor function type
 */
export type TaskExecutor<TPayload = unknown, TResult = unknown> = (
  task: Task,
  payload: TPayload,
  checkpoint: TaskCheckpoint | null
) => Promise<TaskExecutorResult<TResult>>;

/**
 * Result from a task executor
 */
export interface TaskExecutorResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  checkpoint?: TaskCheckpoint; // Updated checkpoint for resumable tasks
  shouldRetry?: boolean; // Override default retry behavior
}

/**
 * Durable queue interface
 */
export interface IDurableQueue {
  /**
   * Enqueue a new task
   */
  enqueue(task: CreateTask): Promise<string>;

  /**
   * Enqueue multiple tasks atomically
   */
  enqueueBatch(tasks: CreateTask[]): Promise<string[]>;

  /**
   * Get a task by ID
   */
  getTask(id: string): Task | null;

  /**
   * Get all tasks with a specific status
   */
  getTasksByStatus(status: TaskStatus): Task[];

  /**
   * Get tasks by type
   */
  getTasksByType(type: TaskType): Task[];

  /**
   * Get tasks in a group
   */
  getTasksByGroup(groupId: string): Task[];

  /**
   * Get pending tasks for a session
   */
  getPendingForSession(sessionId: string): Task[];

  /**
   * Update a task
   */
  updateTask(id: string, update: UpdateTask): Task | null;

  /**
   * Update task checkpoint (for resumable operations)
   */
  updateCheckpoint(id: string, checkpoint: TaskCheckpoint): void;

  /**
   * Get queue status
   */
  getStatus(): QueueStatus;

  /**
   * Pause the queue
   */
  pause(): void;

  /**
   * Resume the queue
   */
  resume(): void;

  /**
   * Check if queue is paused
   */
  isPaused(): boolean;

  /**
   * Clear completed tasks older than a threshold
   */
  clearCompleted(olderThanMs?: number): number;

  /**
   * Clear failed tasks
   */
  clearFailed(): number;

  /**
   * Retry a failed task
   */
  retryTask(id: string): boolean;

  /**
   * Cancel a pending task
   */
  cancelTask(id: string): boolean;

  /**
   * Recover stale tasks (stuck in processing after browser reload)
   */
  recoverStaleTasks(staleThresholdMs?: number): Promise<number>;

  /**
   * Subscribe to queue events
   */
  subscribe(callbacks: IQueueCallbacks): () => void;
}

/**
 * Queue runner interface - processes tasks from the queue
 */
export interface IQueueRunner {
  /**
   * Start processing tasks
   */
  start(): void;

  /**
   * Stop processing tasks
   */
  stop(): void;

  /**
   * Check if runner is active
   */
  isRunning(): boolean;

  /**
   * Register an executor for a task type
   */
  registerExecutor<TPayload = unknown, TResult = unknown>(
    taskType: TaskType,
    executor: TaskExecutor<TPayload, TResult>
  ): void;

  /**
   * Process the next available task
   */
  processNext(): Promise<TaskProcessResult | null>;

  /**
   * Process all pending tasks (for testing)
   */
  processAll(): Promise<void>;
}
