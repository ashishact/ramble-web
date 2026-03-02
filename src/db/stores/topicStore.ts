import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Topic from '../models/Topic'

const topics = database.get<Topic>('topics')

/** Levenshtein similarity (0-1). */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const matrix: number[][] = []
  for (let i = 0; i <= a.length; i++) matrix[i] = [i]
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return 1 - matrix[a.length][b.length] / maxLen
}

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

  /**
   * Partial-match search with relevance scoring.
   * Same scoring philosophy as entityStore.searchWithRelevance().
   */
  async searchWithRelevance(query: string, limit = 20): Promise<Array<{ topic: Topic; relevance: number }>> {
    if (!query.trim()) return []

    const all = await topics.query().fetch()
    const lq = query.toLowerCase()
    const results: Array<{ topic: Topic; relevance: number }> = []

    for (const topic of all) {
      const nameLower = topic.name.toLowerCase()
      let relevance = 0

      if (nameLower === lq) {
        relevance = 1.0
      } else if (nameLower.startsWith(lq)) {
        relevance = 0.9
      } else if (nameLower.includes(lq)) {
        relevance = 0.7
      } else if (lq.startsWith(nameLower)) {
        relevance = 0.65
      } else {
        // Check category
        if (topic.category && topic.category.toLowerCase().includes(lq)) {
          relevance = 0.4
        }
        // Levenshtein fuzzy match
        if (relevance === 0) {
          const sim = levenshteinSimilarity(lq, nameLower.split(/\s*\/\s*/)[0])
          if (sim > 0.6) {
            relevance = sim * 0.6
          }
        }
      }

      if (relevance > 0) {
        results.push({ topic, relevance })
      }
    }

    return results
      .sort((a, b) => b.relevance - a.relevance)
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

  async delete(id: string): Promise<boolean> {
    try {
      const topic = await topics.find(id)
      await database.write(async () => {
        await topic.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },

  async merge(targetId: string, sourceId: string): Promise<boolean> {
    try {
      const target = await topics.find(targetId)
      const source = await topics.find(sourceId)

      await database.write(async () => {
        // Add source's mention count to target
        await target.update((t) => {
          t.mentionCount += source.mentionCount
          // Keep earlier firstMentioned
          if (source.firstMentioned < t.firstMentioned) {
            t.firstMentioned = source.firstMentioned
          }
          // Keep later lastMentioned
          if (source.lastMentioned > t.lastMentioned) {
            t.lastMentioned = source.lastMentioned
          }
          // Merge entity IDs
          const targetEntityIds = t.entityIdsParsed
          const sourceEntityIds = source.entityIdsParsed
          const mergedEntityIds = [...new Set([...targetEntityIds, ...sourceEntityIds])]
          t.entityIds = JSON.stringify(mergedEntityIds)
        })

        // Delete source
        await source.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },
}
