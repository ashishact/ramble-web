import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import EntityCooccurrence from '../models/EntityCooccurrence'

const cooccurrences = database.get<EntityCooccurrence>('entity_cooccurrences')

/** Canonical ordering: smaller ID first */
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export const cooccurrenceStore = {
  async increment(entityIdA: string, entityIdB: string, contextSnippet: string): Promise<void> {
    if (entityIdA === entityIdB) return
    const [eA, eB] = canonical(entityIdA, entityIdB)

    // Find existing pair
    const existing = await cooccurrences
      .query(
        Q.where('entityA', eA),
        Q.where('entityB', eB),
        Q.take(1)
      )
      .fetch()

    const now = Date.now()

    if (existing.length > 0) {
      const record = existing[0]
      const contexts = record.recentContextsParsed
      // Keep only last 3 snippets
      const updated = [contextSnippet, ...contexts].slice(0, 3)
      await database.write(async () => {
        await record.update((r) => {
          r.count += 1
          r.lastSeen = now
          r.recentContexts = JSON.stringify(updated)
        })
      })
    } else {
      await database.write(async () => {
        await cooccurrences.create((r) => {
          r.entityA = eA
          r.entityB = eB
          r.count = 1
          r.lastSeen = now
          r.recentContexts = JSON.stringify([contextSnippet])
          r.createdAt = now
        })
      })
    }
  },

  async getCount(entityIdA: string, entityIdB: string): Promise<number> {
    const [eA, eB] = canonical(entityIdA, entityIdB)
    const results = await cooccurrences
      .query(
        Q.where('entityA', eA),
        Q.where('entityB', eB),
        Q.take(1)
      )
      .fetch()
    return results.length > 0 ? results[0].count : 0
  },

  async getStrongCooccurrences(entityId: string, minCount = 2): Promise<Array<{ entityId: string; count: number }>> {
    // Query both sides: entityId can be entityA or entityB
    const asA = await cooccurrences
      .query(Q.where('entityA', entityId))
      .fetch()
    const asB = await cooccurrences
      .query(Q.where('entityB', entityId))
      .fetch()

    const results: Array<{ entityId: string; count: number }> = []

    for (const r of asA) {
      if (r.count >= minCount) {
        results.push({ entityId: r.entityB, count: r.count })
      }
    }
    for (const r of asB) {
      if (r.count >= minCount) {
        results.push({ entityId: r.entityA, count: r.count })
      }
    }

    return results.sort((a, b) => b.count - a.count)
  },

  async getCluster(entityId: string, minStrength = 2): Promise<string[]> {
    const strong = await this.getStrongCooccurrences(entityId, minStrength)
    return strong.map(s => s.entityId)
  },

  async getAll(): Promise<EntityCooccurrence[]> {
    return await cooccurrences.query().fetch()
  },
}
