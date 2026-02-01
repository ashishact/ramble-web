import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Goal, { type GoalStatus } from '../models/Goal'

const goals = database.get<Goal>('goals')

export const goalStore = {
  async create(data: {
    statement: string
    type: string
    parentGoalId?: string
    entityIds?: string[]
    topicIds?: string[]
    memoryIds?: string[]
    deadline?: number
    metadata?: Record<string, unknown>
  }): Promise<Goal> {
    const now = Date.now()
    return await database.write(async () => {
      return await goals.create((g) => {
        g.statement = data.statement
        g.type = data.type
        g.status = 'active'
        g.progress = 0
        g.parentGoalId = data.parentGoalId
        g.entityIds = JSON.stringify(data.entityIds ?? [])
        g.topicIds = JSON.stringify(data.topicIds ?? [])
        g.memoryIds = JSON.stringify(data.memoryIds ?? [])
        g.firstExpressed = now
        g.lastReferenced = now
        g.deadline = data.deadline
        g.metadata = JSON.stringify(data.metadata ?? {})
        g.createdAt = now
      })
    })
  },

  async getById(id: string): Promise<Goal | null> {
    try {
      return await goals.find(id)
    } catch {
      return null
    }
  },

  async getByStatus(status: GoalStatus): Promise<Goal[]> {
    return await goals
      .query(
        Q.where('status', status),
        Q.sortBy('lastReferenced', Q.desc)
      )
      .fetch()
  },

  async getActive(): Promise<Goal[]> {
    return await this.getByStatus('active')
  },

  async getRecent(limit = 20): Promise<Goal[]> {
    return await goals
      .query(Q.sortBy('lastReferenced', Q.desc), Q.take(limit))
      .fetch()
  },

  async getTopLevel(): Promise<Goal[]> {
    return await goals
      .query(
        Q.where('parentGoalId', null),
        Q.where('status', 'active'),
        Q.sortBy('lastReferenced', Q.desc)
      )
      .fetch()
  },

  async getChildren(parentGoalId: string): Promise<Goal[]> {
    return await goals
      .query(
        Q.where('parentGoalId', parentGoalId),
        Q.sortBy('createdAt', Q.asc)
      )
      .fetch()
  },

  async updateProgress(id: string, progress: number): Promise<void> {
    try {
      const goal = await goals.find(id)
      await database.write(async () => {
        await goal.update((g) => {
          g.progress = Math.max(0, Math.min(100, progress))
          g.lastReferenced = Date.now()
          if (progress >= 100) {
            g.status = 'achieved'
            g.achievedAt = Date.now()
          }
        })
      })
    } catch {
      // Not found
    }
  },

  async updateStatus(id: string, status: GoalStatus): Promise<void> {
    try {
      const goal = await goals.find(id)
      await database.write(async () => {
        await goal.update((g) => {
          g.status = status
          g.lastReferenced = Date.now()
          if (status === 'achieved') {
            g.progress = 100
            g.achievedAt = Date.now()
          }
        })
      })
    } catch {
      // Not found
    }
  },

  async recordReference(id: string): Promise<void> {
    try {
      const goal = await goals.find(id)
      await database.write(async () => {
        await goal.update((g) => {
          g.lastReferenced = Date.now()
        })
      })
    } catch {
      // Not found
    }
  },

  async update(id: string, data: {
    statement?: string
    type?: string
    metadata?: Record<string, unknown>
  }): Promise<Goal | null> {
    try {
      const goal = await goals.find(id)
      await database.write(async () => {
        await goal.update((g) => {
          if (data.statement !== undefined) g.statement = data.statement
          if (data.type !== undefined) g.type = data.type
          if (data.metadata !== undefined) g.metadata = JSON.stringify(data.metadata)
        })
      })
      return goal
    } catch {
      return null
    }
  },

  async search(query: string, limit = 10): Promise<Goal[]> {
    const all = await goals.query().fetch()
    const lowerQuery = query.toLowerCase()

    return all
      .filter(g => g.statement.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
  },

  async delete(id: string): Promise<boolean> {
    try {
      const goal = await goals.find(id)
      await database.write(async () => {
        await goal.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },

  async getAll(): Promise<Goal[]> {
    return await goals.query().fetch()
  },
}
