import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Insight from '../models/Insight'

const insights = database.get<Insight>('insights')

export const insightStore = {
  async create(data: {
    content: string
    type: string
    sourceMemoryIds?: string[]
    confidence?: number
    metadata?: Record<string, unknown>
  }): Promise<Insight> {
    const now = Date.now()
    return await database.write(async () => {
      return await insights.create((i) => {
        i.content = data.content
        i.type = data.type
        i.sourceMemoryIds = JSON.stringify(data.sourceMemoryIds ?? [])
        i.generatedAt = now
        i.confidence = data.confidence ?? 0.7
        i.metadata = JSON.stringify(data.metadata ?? {})
      })
    })
  },

  async getById(id: string): Promise<Insight | null> {
    try {
      return await insights.find(id)
    } catch {
      return null
    }
  },

  async getByType(type: string): Promise<Insight[]> {
    return await insights
      .query(
        Q.where('type', type),
        Q.sortBy('generatedAt', Q.desc)
      )
      .fetch()
  },

  async getRecent(limit = 20): Promise<Insight[]> {
    return await insights
      .query(Q.sortBy('generatedAt', Q.desc), Q.take(limit))
      .fetch()
  },

  async getAll(): Promise<Insight[]> {
    return await insights.query(Q.sortBy('generatedAt', Q.desc)).fetch()
  },

  async revise(id: string, newContent: string, newConfidence?: number): Promise<Insight | null> {
    try {
      const insight = await insights.find(id)
      await database.write(async () => {
        await insight.update((i) => {
          i.content = newContent
          i.revisedAt = Date.now()
          if (newConfidence !== undefined) i.confidence = newConfidence
        })
      })
      return insight
    } catch {
      return null
    }
  },

  async delete(id: string): Promise<boolean> {
    try {
      const insight = await insights.find(id)
      await database.write(async () => {
        await insight.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },
}
