import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Topic from '../models/Topic'

const topics = database.get<Topic>('topics')

export const topicStore = {
  async create(data: {
    name: string
    description?: string
    category?: string
    entityIds?: string[]
    metadata?: Record<string, unknown>
  }): Promise<Topic> {
    const now = Date.now()
    return await database.write(async () => {
      return await topics.create((t) => {
        t.name = data.name
        t.description = data.description
        t.category = data.category
        t.entityIds = JSON.stringify(data.entityIds ?? [])
        t.firstMentioned = now
        t.lastMentioned = now
        t.mentionCount = 1
        t.metadata = JSON.stringify(data.metadata ?? {})
        t.createdAt = now
      })
    })
  },

  async getById(id: string): Promise<Topic | null> {
    try {
      return await topics.find(id)
    } catch {
      return null
    }
  },

  async getByName(name: string): Promise<Topic | null> {
    const results = await topics
      .query(Q.where('name', name), Q.take(1))
      .fetch()
    return results[0] ?? null
  },

  async getByCategory(category: string): Promise<Topic[]> {
    return await topics
      .query(Q.where('category', category), Q.sortBy('mentionCount', Q.desc))
      .fetch()
  },

  async getRecent(limit = 20): Promise<Topic[]> {
    return await topics
      .query(Q.sortBy('lastMentioned', Q.desc), Q.take(limit))
      .fetch()
  },

  async getMostMentioned(limit = 20): Promise<Topic[]> {
    return await topics
      .query(Q.sortBy('mentionCount', Q.desc), Q.take(limit))
      .fetch()
  },

  async getAll(): Promise<Topic[]> {
    return await topics.query().fetch()
  },

  async recordMention(id: string): Promise<void> {
    try {
      const topic = await topics.find(id)
      await database.write(async () => {
        await topic.update((t) => {
          t.lastMentioned = Date.now()
          t.mentionCount += 1
        })
      })
    } catch {
      // Not found
    }
  },

  async update(id: string, data: {
    name?: string
    description?: string
    category?: string
    entityIds?: string[]
    metadata?: Record<string, unknown>
  }): Promise<Topic | null> {
    try {
      const topic = await topics.find(id)
      await database.write(async () => {
        await topic.update((t) => {
          if (data.name !== undefined) t.name = data.name
          if (data.description !== undefined) t.description = data.description
          if (data.category !== undefined) t.category = data.category
          if (data.entityIds !== undefined) t.entityIds = JSON.stringify(data.entityIds)
          if (data.metadata !== undefined) t.metadata = JSON.stringify(data.metadata)
        })
      })
      return topic
    } catch {
      return null
    }
  },

  async addEntity(topicId: string, entityId: string): Promise<void> {
    try {
      const topic = await topics.find(topicId)
      const entityIds = topic.entityIdsParsed
      if (!entityIds.includes(entityId)) {
        entityIds.push(entityId)
        await database.write(async () => {
          await topic.update((t) => {
            t.entityIds = JSON.stringify(entityIds)
          })
        })
      }
    } catch {
      // Not found
    }
  },

  async search(query: string, limit = 10): Promise<Topic[]> {
    const all = await topics.query().fetch()
    const lowerQuery = query.toLowerCase()

    return all
      .filter(t => t.name.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
  },

  async findOrCreate(data: {
    name: string
    category?: string
  }): Promise<Topic> {
    const existing = await this.getByName(data.name)
    if (existing) {
      await this.recordMention(existing.id)
      return existing
    }
    return await this.create(data)
  },
}
