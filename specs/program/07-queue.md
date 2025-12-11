# Layer 7: Durable Queue System

## Queue Design (Browser-Safe)

```typescript
interface DurableQueue {
  // Enqueue a task
  enqueue(task: Task): Promise<string>;

  // Process next available task
  processNext(): Promise<ProcessResult | null>;

  // Get queue status
  getStatus(): Promise<QueueStatus>;

  // Recover from interruption
  recover(): Promise<number>; // Returns number of recovered tasks
}

interface Task {
  id?: string;
  type: TaskType;
  payload: any;
  priority: number;
  maxAttempts: number;
  executeAt: number; // Scheduled time
}

type TaskType =
  | 'extract_from_unit'
  | 'run_observer'
  | 'consolidate_memory'
  | 'check_chain_dormancy'
  | 'generate_session_summary'
  | 'decay_claims'
  | 'check_goal_progress'
  | 'generate_synthesis';

interface ProcessResult {
  taskId: string;
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
}
```

## Implementation

```typescript
class IndexedDBDurableQueue implements DurableQueue {
  private store: TinyBaseStore;
  private processing: Set<string> = new Set();
  private readonly STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

  constructor(store: TinyBaseStore) {
    this.store = store;
  }

  async enqueue(task: Task): Promise<string> {
    const id = task.id || generateId();

    await this.store.setRow('task_queue', id, {
      task_type: task.type,
      payload_json: JSON.stringify(task.payload),
      status: 'pending',
      attempts: 0,
      max_attempts: task.maxAttempts,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      error: null,
      priority: task.priority,
      execute_at: task.executeAt
    });

    return id;
  }

  async processNext(): Promise<ProcessResult | null> {
    // Get next available task
    const task = await this.getNextTask();
    if (!task) return null;

    const taskId = task.id;

    // Mark as processing
    await this.store.setRow('task_queue', taskId, {
      ...task,
      status: 'processing',
      started_at: Date.now(),
      attempts: task.attempts + 1
    });

    this.processing.add(taskId);

    try {
      const startTime = Date.now();
      const output = await this.executeTask(task);
      const duration = Date.now() - startTime;

      // Mark as completed
      await this.store.setRow('task_queue', taskId, {
        ...task,
        status: 'completed',
        completed_at: Date.now(),
        attempts: task.attempts + 1
      });

      this.processing.delete(taskId);

      return { taskId, success: true, output, duration };

    } catch (error) {
      const shouldRetry = task.attempts + 1 < task.max_attempts;

      await this.store.setRow('task_queue', taskId, {
        ...task,
        status: shouldRetry ? 'pending' : 'failed',
        error: error.message,
        attempts: task.attempts + 1
      });

      this.processing.delete(taskId);

      return {
        taskId,
        success: false,
        error: error.message,
        duration: Date.now() - task.started_at
      };
    }
  }

  async recover(): Promise<number> {
    // Find tasks that were processing but never completed (crash recovery)
    const allTasks = this.store.getTable('task_queue');
    let recovered = 0;

    for (const [id, task] of Object.entries(allTasks)) {
      if (task.status === 'processing') {
        const staleTime = Date.now() - task.started_at;

        if (staleTime > this.STALE_THRESHOLD) {
          // Task was interrupted - reset to pending if retries remain
          const shouldRetry = task.attempts < task.max_attempts;

          await this.store.setRow('task_queue', id, {
            ...task,
            status: shouldRetry ? 'pending' : 'failed',
            error: shouldRetry ? null : 'Task interrupted and max retries exceeded'
          });

          recovered++;
        }
      }
    }

    return recovered;
  }

  private async getNextTask(): Promise<any | null> {
    const now = Date.now();
    const allTasks = this.store.getTable('task_queue');

    // Filter for pending tasks that are ready to execute
    const pendingTasks = Object.entries(allTasks)
      .filter(([id, task]) =>
        task.status === 'pending' &&
        task.execute_at <= now &&
        !this.processing.has(id)
      )
      .map(([id, task]) => ({ id, ...task }));

    if (pendingTasks.length === 0) return null;

    // Sort by priority (higher first) then by created_at (older first)
    pendingTasks.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.created_at - b.created_at;
    });

    return pendingTasks[0];
  }

  private async executeTask(task: any): Promise<any> {
    const payload = JSON.parse(task.payload_json);

    switch (task.task_type as TaskType) {
      case 'extract_from_unit':
        return await extractionPipeline.process(payload.unitId);

      case 'run_observer':
        return await observerSystem.runObserver(payload.observerId, payload.context);

      case 'consolidate_memory':
        return await memorySystem.consolidate(payload.sessionId);

      case 'check_chain_dormancy':
        return await chainManager.checkDormancy(payload.chainId);

      case 'generate_session_summary':
        return await synthesizer.generateSessionSummary(payload.sessionId);

      case 'decay_claims':
        return await memorySystem.decayAllClaims();

      case 'check_goal_progress':
        return await goalSystem.checkProgress(payload.goalId);

      case 'generate_synthesis':
        return await synthesizer.generate(payload.type, payload.params);

      default:
        throw new Error(`Unknown task type: ${task.task_type}`);
    }
  }
}
```

## Queue Runner

```typescript
class QueueRunner {
  private queue: DurableQueue;
  private running: boolean = false;
  private pollInterval: number = 1000; // 1 second

  constructor(queue: DurableQueue) {
    this.queue = queue;
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Recover any interrupted tasks
    const recovered = await this.queue.recover();
    if (recovered > 0) {
      console.log(`Recovered ${recovered} interrupted tasks`);
    }

    this.running = true;
    this.poll();
  }

  stop(): void {
    this.running = false;
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.queue.processNext();

        if (result) {
          console.log(`Task ${result.taskId}: ${result.success ? 'success' : 'failed'} (${result.duration}ms)`);
        } else {
          // No tasks available, wait before polling again
          await sleep(this.pollInterval);
        }
      } catch (error) {
        console.error('Queue processing error:', error);
        await sleep(this.pollInterval);
      }
    }
  }
}

// Visibility API integration for browser
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    queueRunner.start();
  } else {
    // Continue processing for a bit, then pause
    setTimeout(() => {
      if (document.visibilityState === 'hidden') {
        queueRunner.stop();
      }
    }, 5000);
  }
});
```

---

## Navigation

- Previous: [06-goal-system.md](./06-goal-system.md)
- Next: [08-observers.md](./08-observers.md)
