import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Session from '../models/Session'

const sessions = database.get<Session>('sessions')

export const sessionStore = {
  async create(data: {
    startedAt?: number
    metadata?: Record<string, unknown>
  }): Promise<Session> {
    const now = Date.now()
    return await database.write(async () => {
      return await sessions.create((session) => {
        session.startedAt = data.startedAt ?? now
        session.unitCount = 0
        session.metadata = JSON.stringify(data.metadata ?? {})
      })
    })
  },

  async getById(id: string): Promise<Session | null> {
    try {
      return await sessions.find(id)
    } catch {
      return null
    }
  },

  async getActive(): Promise<Session | null> {
    const results = await sessions
      .query(Q.where('endedAt', null), Q.sortBy('startedAt', Q.desc), Q.take(1))
      .fetch()
    return results[0] ?? null
  },

  async getRecent(limit = 10): Promise<Session[]> {
    return await sessions
      .query(Q.sortBy('startedAt', Q.desc), Q.take(limit))
      .fetch()
  },

  async endSession(id: string): Promise<Session | null> {
    try {
      const session = await sessions.find(id)
      await database.write(async () => {
        await session.update((s) => {
          s.endedAt = Date.now()
        })
      })
      return session
    } catch {
      return null
    }
  },

  async incrementUnitCount(id: string): Promise<void> {
    try {
      const session = await sessions.find(id)
      await database.write(async () => {
        await session.update((s) => {
          s.unitCount += 1
        })
      })
    } catch {
      // Session not found
    }
  },

  async updateSummary(id: string, summary: string): Promise<void> {
    try {
      const session = await sessions.find(id)
      await database.write(async () => {
        await session.update((s) => {
          s.summary = summary
        })
      })
    } catch {
      // Session not found
    }
  },
}
