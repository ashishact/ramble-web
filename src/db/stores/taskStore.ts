import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Task, { type TaskStatus } from '../models/Task'

const tasks = database.get<Task>('tasks')

export const taskStore = {
  async create(data: {
    taskType: string
    payload: Record<string, unknown>
    priority?: number
    maxAttempts?: number
    scheduledAt?: number
    sessionId?: string
  }): Promise<Task> {
    const now = Date.now()
    return await database.write(async () => {
      return await tasks.create((t) => {
        t.taskType = data.taskType
        t.status = 'pending'
        t.priority = data.priority ?? 0
        t.payload = JSON.stringify(data.payload)
        t.attempts = 0
        t.maxAttempts = data.maxAttempts ?? 3
        t.createdAt = now
        t.scheduledAt = data.scheduledAt ?? now
        t.sessionId = data.sessionId
      })
    })
  },

  async getById(id: string): Promise<Task | null> {
    try {
      return await tasks.find(id)
    } catch {
      return null
    }
  },

  async getPending(limit = 10): Promise<Task[]> {
    const now = Date.now()
    return await tasks
      .query(
        Q.where('status', 'pending'),
        Q.where('scheduledAt', Q.lte(now)),
        Q.sortBy('priority', Q.desc),
        Q.sortBy('createdAt', Q.asc),
        Q.take(limit)
      )
      .fetch()
  },

  /**
   * Get tasks that can be retried: pending tasks + failed tasks
   * Failed tasks are included so they can be retried on app reload
   * (user may have fixed the issue, e.g., corrected API key)
   */
  async getRetryable(limit = 10): Promise<Task[]> {
    const now = Date.now()
    return await tasks
      .query(
        Q.or(
          Q.and(
            Q.where('status', 'pending'),
            Q.where('scheduledAt', Q.lte(now))
          ),
          Q.where('status', 'failed')
        ),
        Q.sortBy('priority', Q.desc),
        Q.sortBy('createdAt', Q.asc),
        Q.take(limit)
      )
      .fetch()
  },

  /**
   * Reset a failed task back to pending for retry
   */
  async resetForRetry(id: string): Promise<void> {
    try {
      const task = await tasks.find(id)
      await database.write(async () => {
        await task.update((t) => {
          t.status = 'pending'
          t.attempts = 0
          t.scheduledAt = Date.now()
          t.lastError = undefined
        })
      })
    } catch {
      // Not found
    }
  },

  async getByStatus(status: TaskStatus): Promise<Task[]> {
    return await tasks
      .query(
        Q.where('status', status),
        Q.sortBy('createdAt', Q.desc)
      )
      .fetch()
  },

  async getByType(taskType: string): Promise<Task[]> {
    return await tasks
      .query(
        Q.where('taskType', taskType),
        Q.sortBy('createdAt', Q.desc)
      )
      .fetch()
  },

  async start(id: string): Promise<void> {
    try {
      const task = await tasks.find(id)
      await database.write(async () => {
        await task.update((t) => {
          t.status = 'running'
          t.startedAt = Date.now()
          t.attempts += 1
        })
      })
    } catch {
      // Not found
    }
  },

  async complete(id: string, result?: Record<string, unknown>): Promise<void> {
    try {
      const task = await tasks.find(id)
      await database.write(async () => {
        await task.update((t) => {
          t.status = 'completed'
          t.completedAt = Date.now()
          if (result) t.result = JSON.stringify(result)
        })
      })
    } catch {
      // Not found
    }
  },

  async fail(id: string, error: string): Promise<void> {
    try {
      const task = await tasks.find(id)
      await database.write(async () => {
        await task.update((t) => {
          if (t.attempts >= t.maxAttempts) {
            // Exhausted all retries - mark as permanently failed
            t.status = 'failed'
          } else {
            // Schedule retry with exponential backoff
            // Attempt 1 → retry after 10s, Attempt 2 → retry after 60s, etc.
            const backoffSeconds = Math.pow(6, t.attempts) * 10 // 10s, 60s, 360s
            t.status = 'pending'
            t.scheduledAt = Date.now() + (backoffSeconds * 1000)
          }
          t.lastError = error
        })
      })
    } catch {
      // Not found
    }
  },

  async saveCheckpoint(id: string, checkpoint: Record<string, unknown>): Promise<void> {
    try {
      const task = await tasks.find(id)
      await database.write(async () => {
        await task.update((t) => {
          t.checkpoint = JSON.stringify(checkpoint)
        })
      })
    } catch {
      // Not found
    }
  },

  async reschedule(id: string, scheduledAt: number): Promise<void> {
    try {
      const task = await tasks.find(id)
      await database.write(async () => {
        await task.update((t) => {
          t.status = 'pending'
          t.scheduledAt = scheduledAt
        })
      })
    } catch {
      // Not found
    }
  },

  async delete(id: string): Promise<boolean> {
    try {
      const task = await tasks.find(id)
      await database.write(async () => {
        await task.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },

  async getAll(): Promise<Task[]> {
    return await tasks.query().fetch()
  },
}

// Expose for debugging in browser console
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).debugTasks = async () => {
    const all = await taskStore.getAll()
    console.log('All tasks:', all.length)
    for (const t of all) {
      console.log(`  - ${t.id} [${t.status}] ${t.taskType} (attempts: ${t.attempts}/${t.maxAttempts})`)
      console.log(`    payload:`, t.payloadParsed)
      if (t.lastError) console.log(`    lastError:`, t.lastError)
    }
    return all
  }

  // Reset all failed tasks for retry (call this after fixing API key, etc.)
  ;(window as unknown as Record<string, unknown>).retryFailedTasks = async () => {
    const failed = await taskStore.getByStatus('failed')
    console.log(`Found ${failed.length} failed tasks`)

    let reset = 0
    for (const task of failed) {
      await taskStore.resetForRetry(task.id)
      reset++
      console.log(`  Reset task ${task.id} (${task.taskType})`)
    }

    console.log(`Reset ${reset} tasks. Reload the page to trigger retry.`)
    return { reset }
  }
}
