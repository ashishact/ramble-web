import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Memory from '../models/Memory'

const memories = database.get<Memory>('memories')

export const memoryStore = {
  async create(data: {
    content: string
    type: string
    subject?: string
    entityIds?: string[]
    topicIds?: string[]
    sourceConversationIds?: string[]
    confidence?: number
    importance?: number
    validFrom?: number
    validUntil?: number
    supersedes?: string
    metadata?: Record<string, unknown>
  }): Promise<Memory> {
    const now = Date.now()
    return await database.write(async () => {
      return await memories.create((m) => {
        m.content = data.content
        m.type = data.type
        m.subject = data.subject
        m.entityIds = JSON.stringify(data.entityIds ?? [])
        m.topicIds = JSON.stringify(data.topicIds ?? [])
        m.sourceConversationIds = JSON.stringify(data.sourceConversationIds ?? [])
        m.confidence = data.confidence ?? 0.8
        m.importance = data.importance ?? 0.5
        m.validFrom = data.validFrom
        m.validUntil = data.validUntil
        m.firstExpressed = now
        m.lastReinforced = now
        m.reinforcementCount = 1
        m.supersedes = data.supersedes
        m.supersededBy = undefined // Explicitly set for query compatibility
        m.metadata = JSON.stringify(data.metadata ?? {})
        m.createdAt = now
      })
    })
  },

  async getById(id: string): Promise<Memory | null> {
    try {
      return await memories.find(id)
    } catch {
      return null
    }
  },

  async getByType(type: string): Promise<Memory[]> {
    return await memories
      .query(
        Q.where('type', type),
        Q.where('supersededBy', null),
        Q.sortBy('importance', Q.desc)
      )
      .fetch()
  },

  async getBySubject(subject: string): Promise<Memory[]> {
    return await memories
      .query(
        Q.where('subject', subject),
        Q.where('supersededBy', null),
        Q.sortBy('lastReinforced', Q.desc)
      )
      .fetch()
  },

  async getActive(limit = 50): Promise<Memory[]> {
    return await memories
      .query(
        Q.where('supersededBy', null),
        Q.sortBy('importance', Q.desc),
        Q.sortBy('lastReinforced', Q.desc),
        Q.take(limit)
      )
      .fetch()
  },

  async getRecent(limit = 50): Promise<Memory[]> {
    return await memories
      .query(
        Q.where('supersededBy', null),
        Q.sortBy('lastReinforced', Q.desc),
        Q.take(limit)
      )
      .fetch()
  },

  async getMostImportant(limit = 20): Promise<Memory[]> {
    return await memories
      .query(
        Q.where('supersededBy', null),
        Q.sortBy('importance', Q.desc),
        Q.take(limit)
      )
      .fetch()
  },

  async reinforce(id: string): Promise<void> {
    try {
      const memory = await memories.find(id)
      await database.write(async () => {
        await memory.update((m) => {
          m.lastReinforced = Date.now()
          m.reinforcementCount += 1
          // Boost importance slightly on reinforcement
          m.importance = Math.min(1, m.importance + 0.05)
        })
      })
    } catch {
      // Not found
    }
  },

  async supersede(oldId: string, newId: string): Promise<void> {
    try {
      const oldMemory = await memories.find(oldId)
      await database.write(async () => {
        await oldMemory.update((m) => {
          m.supersededBy = newId
        })
      })
    } catch {
      // Not found
    }
  },

  async update(id: string, data: {
    content?: string
    type?: string
    confidence?: number
    importance?: number
    validUntil?: number
    metadata?: Record<string, unknown>
  }): Promise<Memory | null> {
    try {
      const memory = await memories.find(id)
      await database.write(async () => {
        await memory.update((m) => {
          if (data.content !== undefined) m.content = data.content
          if (data.type !== undefined) m.type = data.type
          if (data.confidence !== undefined) m.confidence = data.confidence
          if (data.importance !== undefined) m.importance = data.importance
          if (data.validUntil !== undefined) m.validUntil = data.validUntil
          if (data.metadata !== undefined) m.metadata = JSON.stringify(data.metadata)
        })
      })
      return memory
    } catch {
      return null
    }
  },

  async search(query: string, limit = 20): Promise<Memory[]> {
    const all = await memories
      .query(Q.where('supersededBy', null))
      .fetch()

    const lowerQuery = query.toLowerCase()
    return all
      .filter(m => m.content.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
  },

  async getForContext(entityIds: string[], topicIds: string[], limit = 10): Promise<Memory[]> {
    // Get memories related to the given entities or topics
    const all = await this.getActive(200)

    return all
      .filter(m => {
        const memEntityIds = m.entityIdsParsed
        const memTopicIds = m.topicIdsParsed
        return (
          entityIds.some(id => memEntityIds.includes(id)) ||
          topicIds.some(id => memTopicIds.includes(id))
        )
      })
      .slice(0, limit)
  },

  async getAll(): Promise<Memory[]> {
    return await memories.query().fetch()
  },
}

// Expose for debugging in browser console
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).debugMemories = async () => {
    const all = await memoryStore.getAll()
    console.log('All memories:', all.length)
    for (const m of all) {
      console.log(`  - [${m.type}] ${m.content.slice(0, 60)}... (supersededBy: ${m.supersededBy ?? 'none'})`)
    }
    return all
  }
}
