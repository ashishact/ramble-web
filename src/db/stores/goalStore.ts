/**
 * Goal Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IGoalStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Goal, CreateGoal, UpdateGoal, GoalStatus } from '../../program/types'
import GoalModel from '../models/Goal'

export function createGoalStore(db: Database): IGoalStore {
  const collection = db.get<GoalModel>('goals')

  return {
    async getById(id: string): Promise<Goal | null> {
      try {
        const model = await collection.find(id)
        return modelToGoal(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Goal[]> {
      const models = await collection.query().fetch()
      return models.map(modelToGoal)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateGoal): Promise<Goal> {
      const model = await db.write(() =>
        collection.create((goal) => {
          goal.statement = data.statement
          goal.goalType = data.goalType
          goal.timeframe = data.timeframe
          goal.status = data.status
          goal.progressValue = data.progressValue
          goal.priority = data.priority
          goal.createdAt = data.createdAt
          goal.achievedAt = data.achievedAt
          goal.parentGoalId = data.parentGoalId
        })
      )
      return modelToGoal(model)
    },

    async update(id: string, data: UpdateGoal): Promise<Goal | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((goal) => {
          if (data.statement !== undefined) goal.statement = data.statement
          if (data.status !== undefined) goal.status = data.status
          if (data.progressValue !== undefined) goal.progressValue = data.progressValue
          if (data.priority !== undefined) goal.priority = data.priority
          if (data.achievedAt !== undefined) goal.achievedAt = data.achievedAt
        })
        return modelToGoal(updated)
      } catch {
        return null
      }
    },

    async delete(id: string): Promise<boolean> {
      try {
        const model = await collection.find(id)
        await model.destroyPermanently()
        return true
      } catch {
        return false
      }
    },

    async getByStatus(status: GoalStatus): Promise<Goal[]> {
      const models = await collection.query(Q.where('status', status)).fetch()
      return models.map(modelToGoal)
    },

    async getActive(): Promise<Goal[]> {
      const models = await collection
        .query(Q.where('status', Q.oneOf(['active', 'in_progress'])))
        .fetch()
      return models.map(modelToGoal)
    },

    async getByParent(parentId: string | null): Promise<Goal[]> {
      const query = parentId
        ? Q.where('parentGoalId', parentId)
        : Q.where('parentGoalId', null)
      const models = await collection.query(query).fetch()
      return models.map(modelToGoal)
    },

    async getRoots(): Promise<Goal[]> {
      const models = await collection.query(Q.where('parentGoalId', null)).fetch()
      return models.map(modelToGoal)
    },

    async getChildren(goalId: string): Promise<Goal[]> {
      const models = await collection.query(Q.where('parentGoalId', goalId)).fetch()
      return models.map(modelToGoal)
    },

    async updateProgress(id: string, value: number): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((goal) => {
          goal.progressValue = value
        })
      } catch {
        // Ignore errors
      }
    },

    async updateStatus(id: string, status: GoalStatus): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((goal) => {
          goal.status = status
          if (status === 'achieved') {
            goal.achievedAt = Date.now()
          }
        })
      } catch {
        // Ignore errors
      }
    },

    async updateLastReferenced(id: string): Promise<void> {
      // Note: Goals don't have lastReferenced field in schema
      // This is a no-op for now
    },

    subscribe(callback: SubscriptionCallback<Goal>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToGoal))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToGoal(model: GoalModel): Goal {
  return {
    id: model.id,
    statement: model.statement,
    goalType: model.goalType,
    timeframe: model.timeframe,
    status: model.status as GoalStatus,
    progressValue: model.progressValue,
    priority: model.priority,
    createdAt: model.createdAt,
    achievedAt: model.achievedAt || null,
    parentGoalId: model.parentGoalId || null,
  }
}
