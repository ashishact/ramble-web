/**
 * Goal Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IGoalStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Goal, CreateGoal, UpdateGoal, GoalStatus, GoalType, GoalTimeframe, ProgressType } from '../../program/types'
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
      const now = Date.now()
      const model = await db.write(() =>
        collection.create((goal) => {
          goal.statement = data.statement
          goal.goalType = data.goalType
          goal.timeframe = data.timeframe
          goal.status = data.status ?? 'active'
          goal.parentGoalId = data.parentGoalId ?? null
          goal.createdAt = now
          goal.lastReferenced = now
          goal.achievedAt = data.achievedAt ?? null
          goal.priority = data.priority
          goal.progressType = data.progressType
          goal.progressValue = data.progressValue ?? 0
          goal.progressIndicatorsJson = data.progressIndicatorsJson ?? '[]'
          goal.blockersJson = data.blockersJson ?? '[]'
          goal.sourceClaimId = data.sourceClaimId
          goal.motivation = data.motivation ?? null
          goal.deadline = data.deadline ?? null
        })
      )
      return modelToGoal(model)
    },

    async update(id: string, data: UpdateGoal): Promise<Goal | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((goal) => {
            if (data.statement !== undefined) goal.statement = data.statement
            if (data.status !== undefined) goal.status = data.status
            if (data.progressValue !== undefined) goal.progressValue = data.progressValue
            if (data.priority !== undefined) goal.priority = data.priority
            if (data.achievedAt !== undefined) goal.achievedAt = data.achievedAt
            if (data.motivation !== undefined) goal.motivation = data.motivation
            if (data.deadline !== undefined) goal.deadline = data.deadline
            if (data.progressIndicatorsJson !== undefined) goal.progressIndicatorsJson = data.progressIndicatorsJson
            if (data.blockersJson !== undefined) goal.blockersJson = data.blockersJson
            goal.lastReferenced = Date.now()
          })
        )
        return modelToGoal(updated)
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
        await db.write(() =>
          model.update((goal) => {
            goal.progressValue = value
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async updateStatus(id: string, status: GoalStatus): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((goal) => {
            goal.status = status
            if (status === 'achieved') {
              goal.achievedAt = Date.now()
            }
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async updateLastReferenced(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((goal) => {
            goal.lastReferenced = Date.now()
          })
        )
      } catch {
        // Ignore errors
      }
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
    goalType: model.goalType as GoalType,
    timeframe: model.timeframe as GoalTimeframe,
    status: model.status as GoalStatus,
    parentGoalId: model.parentGoalId || null,
    createdAt: model.createdAt,
    lastReferenced: model.lastReferenced,
    achievedAt: model.achievedAt || null,
    priority: model.priority,
    progressType: model.progressType as ProgressType,
    progressValue: model.progressValue,
    progressIndicatorsJson: model.progressIndicatorsJson,
    blockersJson: model.blockersJson,
    sourceClaimId: model.sourceClaimId,
    motivation: model.motivation || null,
    deadline: model.deadline || null,
  }
}
