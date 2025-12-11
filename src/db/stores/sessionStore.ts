/**
 * Session Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { ISessionStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Session, CreateSession, UpdateSession } from '../../program/types'
import SessionModel from '../models/Session'

export function createSessionStore(db: Database): ISessionStore {
  const collection = db.get<SessionModel>('sessions')

  return {
    async getById(id: string): Promise<Session | null> {
      try {
        const model = await collection.find(id)
        return modelToSession(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Session[]> {
      const models = await collection.query().fetch()
      return models.map(modelToSession)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateSession): Promise<Session> {
      const model = await db.write(() =>
        collection.create((session) => {
          session.startedAt = data.startedAt
          session.endedAt = data.endedAt
          session.unitCount = data.unitCount
          session.summary = data.summary
          session.moodTrajectoryJson = data.moodTrajectoryJson
        })
      )
      return modelToSession(model)
    },

    async update(id: string, data: UpdateSession): Promise<Session | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((session) => {
          if (data.endedAt !== undefined) session.endedAt = data.endedAt
          if (data.unitCount !== undefined) session.unitCount = data.unitCount
          if (data.summary !== undefined) session.summary = data.summary
          if (data.moodTrajectoryJson !== undefined) session.moodTrajectoryJson = data.moodTrajectoryJson
        })
        return modelToSession(updated)
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

    async getActive(): Promise<Session | null> {
      const models = await collection
        .query(Q.where('endedAt', null), Q.sortBy('startedAt', Q.desc), Q.take(1))
        .fetch()
      return models.length > 0 ? modelToSession(models[0]) : null
    },

    async endSession(id: string): Promise<Session | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((session) => {
          session.endedAt = Date.now()
        })
        return modelToSession(updated)
      } catch {
        return null
      }
    },

    async incrementUnitCount(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((session) => {
          session.unitCount = (session.unitCount || 0) + 1
        })
      } catch {
        // Ignore errors
      }
    },

    subscribe(callback: SubscriptionCallback<Session>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToSession))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToSession(model: SessionModel): Session {
  return {
    id: model.id,
    startedAt: model.startedAt,
    endedAt: model.endedAt || null,
    unitCount: model.unitCount,
    summary: model.summary || null,
    moodTrajectoryJson: model.moodTrajectoryJson || null,
  }
}
