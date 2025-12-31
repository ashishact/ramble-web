import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Entity from '../models/Entity'

const entities = database.get<Entity>('entities')

export const entityStore = {
  async create(data: {
    name: string
    type: string
    aliases?: string[]
    description?: string
    metadata?: Record<string, unknown>
  }): Promise<Entity> {
    const now = Date.now()
    return await database.write(async () => {
      return await entities.create((e) => {
        e.name = data.name
        e.type = data.type
        e.aliases = JSON.stringify(data.aliases ?? [])
        e.description = data.description
        e.firstMentioned = now
        e.lastMentioned = now
        e.mentionCount = 1
        e.metadata = JSON.stringify(data.metadata ?? {})
        e.createdAt = now
      })
    })
  },

  async getById(id: string): Promise<Entity | null> {
    try {
      return await entities.find(id)
    } catch {
      return null
    }
  },

  async getByName(name: string): Promise<Entity | null> {
    const results = await entities
      .query(Q.where('name', name), Q.take(1))
      .fetch()
    return results[0] ?? null
  },

  async getByType(type: string): Promise<Entity[]> {
    return await entities
      .query(Q.where('type', type), Q.sortBy('mentionCount', Q.desc))
      .fetch()
  },

  async getRecent(limit = 20): Promise<Entity[]> {
    return await entities
      .query(Q.sortBy('lastMentioned', Q.desc), Q.take(limit))
      .fetch()
  },

  async getMostMentioned(limit = 20): Promise<Entity[]> {
    return await entities
      .query(Q.sortBy('mentionCount', Q.desc), Q.take(limit))
      .fetch()
  },

  async getAll(): Promise<Entity[]> {
    return await entities.query().fetch()
  },

  async recordMention(id: string): Promise<void> {
    try {
      const entity = await entities.find(id)
      await database.write(async () => {
        await entity.update((e) => {
          e.lastMentioned = Date.now()
          e.mentionCount += 1
        })
      })
    } catch {
      // Not found
    }
  },

  async update(id: string, data: {
    name?: string
    type?: string
    aliases?: string[]
    description?: string
    metadata?: Record<string, unknown>
  }): Promise<Entity | null> {
    try {
      const entity = await entities.find(id)
      await database.write(async () => {
        await entity.update((e) => {
          if (data.name !== undefined) e.name = data.name
          if (data.type !== undefined) e.type = data.type
          if (data.aliases !== undefined) e.aliases = JSON.stringify(data.aliases)
          if (data.description !== undefined) e.description = data.description
          if (data.metadata !== undefined) e.metadata = JSON.stringify(data.metadata)
        })
      })
      return entity
    } catch {
      return null
    }
  },

  async search(query: string, limit = 10): Promise<Entity[]> {
    const all = await entities.query().fetch()
    const lowerQuery = query.toLowerCase()

    return all
      .filter(e =>
        e.name.toLowerCase().includes(lowerQuery) ||
        e.aliasesParsed.some(a => a.toLowerCase().includes(lowerQuery))
      )
      .slice(0, limit)
  },

  async findOrCreate(data: {
    name: string
    type: string
    aliases?: string[]
  }): Promise<Entity> {
    const existing = await this.getByName(data.name)
    if (existing) {
      await this.recordMention(existing.id)
      return existing
    }
    return await this.create(data)
  },

  async delete(id: string): Promise<boolean> {
    try {
      const entity = await entities.find(id)
      await database.write(async () => {
        await entity.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },

  /**
   * Merge source entity into target entity
   * - Combines aliases
   * - Sums mention counts
   * - Keeps earliest firstMentioned
   * - Keeps latest lastMentioned
   * - Deletes source entity
   */
  async merge(targetId: string, sourceId: string): Promise<Entity | null> {
    try {
      const target = await entities.find(targetId)
      const source = await entities.find(sourceId)

      await database.write(async () => {
        // Combine aliases (include source name as alias)
        const targetAliases = target.aliasesParsed
        const sourceAliases = source.aliasesParsed
        const allAliases = [...new Set([...targetAliases, ...sourceAliases, source.name])]
          .filter(a => a !== target.name) // Don't include target name as alias

        await target.update((e) => {
          e.aliases = JSON.stringify(allAliases)
          e.mentionCount = target.mentionCount + source.mentionCount
          e.firstMentioned = Math.min(target.firstMentioned, source.firstMentioned)
          e.lastMentioned = Math.max(target.lastMentioned, source.lastMentioned)
          // Merge descriptions if target doesn't have one
          if (!e.description && source.description) {
            e.description = source.description
          }
        })

        // Delete source
        await source.destroyPermanently()
      })

      return target
    } catch {
      return null
    }
  },

  async getStats(): Promise<{
    total: number
    byType: Record<string, number>
    topMentioned: Array<{ name: string; count: number }>
  }> {
    const all = await entities.query().fetch()

    const byType: Record<string, number> = {}
    for (const e of all) {
      byType[e.type] = (byType[e.type] || 0) + 1
    }

    const topMentioned = all
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 10)
      .map(e => ({ name: e.name, count: e.mentionCount }))

    return { total: all.length, byType, topMentioned }
  },
}
