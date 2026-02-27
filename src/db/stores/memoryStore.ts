import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Memory from '../models/Memory'

const memories = database.get<Memory>('memories')

export type MemoryOrigin = 'speech' | 'typed' | 'pasted' | 'document' | 'meeting'

// Confidence priors by origin — reflects how reliable/precise each input type tends to be
const CONFIDENCE_PRIORS: Record<MemoryOrigin, number> = {
  speech: 0.6,
  typed: 0.55,
  meeting: 0.5,
  pasted: 0.4,
  document: 0.35,
}

// Ownership priors by origin — reflects how first-person / user-owned each input type is
const OWNERSHIP_PRIORS: Record<MemoryOrigin, number> = {
  speech: 0.7,
  typed: 0.65,
  meeting: 0.6,
  pasted: 0.4,
  document: 0.3,
}

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
    // v4 fields
    origin?: MemoryOrigin
    extractionVersion?: string
  }): Promise<Memory> {
    const now = Date.now()
    const origin = data.origin ?? 'typed'
    return await database.write(async () => {
      return await memories.create((m) => {
        m.content = data.content
        m.type = data.type
        m.subject = data.subject
        m.entityIds = JSON.stringify(data.entityIds ?? [])
        m.topicIds = JSON.stringify(data.topicIds ?? [])
        m.sourceConversationIds = JSON.stringify(data.sourceConversationIds ?? [])
        m.confidence = data.confidence ?? CONFIDENCE_PRIORS[origin]
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
        // v4 fields
        m.state = 'provisional'
        m.origin = origin
        m.ownershipScore = OWNERSHIP_PRIORS[origin]
        m.activityScore = 0  // provisional state earns activity through reinforcement
        m.extractionVersion = data.extractionVersion
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

  /**
   * Retrieve active memories ranked by composite retrieval score, with
   * cluster-aware deduplication for contradicting belief groups.
   *
   * score = 0.5 * activityScore + 0.3 * importance + 0.2 * confidence
   *
   * For each contradiction cluster, only the winner (highest score) is
   * returned. Losers stay alive in the DB — they just don't surface in
   * LLM context until they regain the lead through reinforcement.
   *
   * Handles state === '' (WatermelonDB default) as stable for backwards
   * compatibility during migration.
   */
  async getByRetrievalScore(limit = 50): Promise<Memory[]> {
    // Fetch a larger candidate set before in-memory scoring
    const candidates = await memories
      .query(
        Q.where('supersededBy', null),
        Q.take(Math.max(limit * 4, 200))
      )
      .fetch()

    // Score each memory, exclude true tombstones
    const scored = candidates
      .filter(m => m.state !== 'superseded')
      .map(m => ({
        memory: m,
        score: 0.5 * m.activityScore + 0.3 * m.importance + 0.2 * m.confidence,
      }))
      .sort((a, b) => b.score - a.score)  // highest score first

    // Cluster deduplication: iterate highest-score first.
    // When we include a memory, we mark all its contradiction partners as
    // excluded. The first time we see any member of a cluster, it wins.
    const excluded = new Set<string>()
    const result: Memory[] = []

    for (const { memory } of scored) {
      if (excluded.has(memory.id)) continue  // this cluster already has a winner

      result.push(memory)

      // Exclude all contradiction partners so they don't surface in this query
      for (const contradictedId of memory.contradictsParsed) {
        excluded.add(contradictedId)
      }

      if (result.length >= limit) break
    }

    return result
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
          // Boost activityScore on reinforcement (capped at 1.0)
          m.activityScore = Math.min(1, m.activityScore + 0.2)
          // Transition from provisional → stable on first reinforcement
          if (m.state === 'provisional' || m.state === '') {
            m.state = 'stable'
          }
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
          m.state = 'superseded'
        })
      })
    } catch {
      // Not found
    }
  },

  /**
   * Create a bidirectional contradiction edge between two memories.
   * Both memories remain alive and active — the winner is determined at
   * read time by comparing retrieval scores. Neither memory is tombstoned.
   *
   * Also marks both as 'contested' state so the UI can surface the
   * competition relationship visually.
   */
  async addContradiction(idA: string, idB: string): Promise<void> {
    try {
      const [memA, memB] = await Promise.all([
        memories.find(idA),
        memories.find(idB),
      ])

      await database.write(async () => {
        // Add B to A's contradicts list (idempotent)
        await memA.update((m) => {
          const current = m.contradictsParsed
          if (!current.includes(idB)) {
            m.contradicts = JSON.stringify([...current, idB])
          }
          // Mark as contested (losing or competing — doesn't matter yet, resolved at read time)
          if (m.state === 'stable' || m.state === 'provisional' || m.state === '') {
            m.state = 'contested'
          }
        })

        // Add A to B's contradicts list (idempotent)
        await memB.update((m) => {
          const current = m.contradictsParsed
          if (!current.includes(idA)) {
            m.contradicts = JSON.stringify([...current, idA])
          }
          if (m.state === 'stable' || m.state === 'provisional' || m.state === '') {
            m.state = 'contested'
          }
        })
      })
    } catch {
      // One or both memories not found — skip silently
    }
  },

  async update(id: string, data: {
    content?: string
    type?: string
    confidence?: number
    importance?: number
    validUntil?: number
    metadata?: Record<string, unknown>
    // v4 fields
    state?: string
    activityScore?: number
    ownershipScore?: number
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
          if (data.state !== undefined) m.state = data.state
          if (data.activityScore !== undefined) m.activityScore = data.activityScore
          if (data.ownershipScore !== undefined) m.ownershipScore = data.ownershipScore
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

  async delete(id: string): Promise<boolean> {
    try {
      const memory = await memories.find(id)
      await database.write(async () => {
        await memory.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
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
