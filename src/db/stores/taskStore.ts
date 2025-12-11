/**
 * Task Store - WatermelonDB Implementation
 *
 * Durable task queue persisted to IndexedDB via WatermelonDB.
 * Tasks are persisted to enable recovery after browser reload.
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { ITaskStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Task, CreateTask, UpdateTask, TaskStatus, TaskPriority } from '../../program/types'
import { PRIORITY_VALUES } from '../../program/schemas/task'
import TaskModel from '../models/Task'

export function createTaskStore(db: Database): ITaskStore {
  const collection = db.get<TaskModel>('tasks')

  return {
    async getById(id: string): Promise<Task | null> {
      try {
        const model = await collection.find(id)
        return modelToTask(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Task[]> {
      const models = await collection.query().fetch()
      return models.map(modelToTask)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateTask): Promise<Task> {
      const now = Date.now()
      const priority = data.priority ?? 'normal'
      const model = await db.write(() =>
        collection.create((task) => {
          task.taskType = data.taskType
          task.payloadJson = data.payloadJson
          task.status = 'pending'
          task.priority = priority
          task.priorityValue = PRIORITY_VALUES[priority]
          task.attempts = 0
          task.maxAttempts = data.maxAttempts ?? 5
          task.lastError = null
          task.lastErrorAt = null
          task.backoffConfigJson = data.backoffConfigJson ?? '{}'
          task.checkpointJson = null
          task.createdAt = now
          task.startedAt = null
          task.completedAt = null
          task.executeAt = data.executeAt ?? now
          task.nextRetryAt = null
          task.groupId = data.groupId ?? null
          task.dependsOn = data.dependsOn ?? null
          task.sessionId = data.sessionId ?? null
        })
      )
      return modelToTask(model)
    },

    async update(id: string, data: UpdateTask): Promise<Task | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((task) => {
            if (data.status !== undefined) task.status = data.status
            if (data.priority !== undefined) {
              task.priority = data.priority
              task.priorityValue = PRIORITY_VALUES[data.priority]
            }
            if (data.attempts !== undefined) task.attempts = data.attempts
            if (data.lastError !== undefined) task.lastError = data.lastError
            if (data.lastErrorAt !== undefined) task.lastErrorAt = data.lastErrorAt
            if (data.checkpointJson !== undefined) task.checkpointJson = data.checkpointJson
            if (data.startedAt !== undefined) task.startedAt = data.startedAt
            if (data.completedAt !== undefined) task.completedAt = data.completedAt
            if (data.nextRetryAt !== undefined) task.nextRetryAt = data.nextRetryAt
          })
        )
        return modelToTask(updated)
      } catch {
        return null
      }
    },

    async delete(id: string): Promise<boolean> {
      try {
        const model = await collection.find(id)
        await db.write(() => model.destroyPermanently())
        return true
      } catch {
        return false
      }
    },

    async getPending(): Promise<Task[]> {
      const now = Date.now()
      const models = await collection.query(
        Q.where('status', 'pending'),
        Q.where('executeAt', Q.lte(now))
      ).fetch()
      return models.map(modelToTask)
    },

    async getRetryable(): Promise<Task[]> {
      const now = Date.now()
      const models = await collection.query(
        Q.where('status', 'failed')
      ).fetch()

      // Filter in JS for complex conditions (attempts < maxAttempts, nextRetryAt)
      return models
        .filter(m => m.attempts < m.maxAttempts && (m.nextRetryAt === null || m.nextRetryAt <= now))
        .map(modelToTask)
    },

    async getByStatus(status: string): Promise<Task[]> {
      const models = await collection.query(Q.where('status', status)).fetch()
      return models.map(modelToTask)
    },

    async getBySessionId(sessionId: string): Promise<Task[]> {
      const models = await collection.query(Q.where('sessionId', sessionId)).fetch()
      return models.map(modelToTask)
    },

    async markStarted(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((task) => {
            task.status = 'processing'
            task.startedAt = Date.now()
            task.attempts = task.attempts + 1
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async markCompleted(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((task) => {
            task.status = 'completed'
            task.completedAt = Date.now()
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async markFailed(id: string, error: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((task) => {
            task.status = 'failed'
            task.lastError = error
            task.lastErrorAt = Date.now()
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async updateCheckpoint(id: string, checkpoint: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((task) => {
            task.checkpointJson = checkpoint
          })
        )
      } catch {
        // Ignore errors
      }
    },

    subscribe(callback: SubscriptionCallback<Task>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToTask))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToTask(model: TaskModel): Task {
  return {
    id: model.id,
    taskType: model.taskType as Task['taskType'],
    payloadJson: model.payloadJson,
    status: model.status as TaskStatus,
    priority: model.priority as TaskPriority,
    priorityValue: model.priorityValue,
    attempts: model.attempts,
    maxAttempts: model.maxAttempts,
    lastError: model.lastError,
    lastErrorAt: model.lastErrorAt,
    backoffConfigJson: model.backoffConfigJson,
    checkpointJson: model.checkpointJson,
    createdAt: model.createdAt,
    startedAt: model.startedAt,
    completedAt: model.completedAt,
    executeAt: model.executeAt,
    nextRetryAt: model.nextRetryAt,
    groupId: model.groupId,
    dependsOn: model.dependsOn,
    sessionId: model.sessionId,
  }
}
