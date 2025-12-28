/**
 * Derived Store - WatermelonDB Implementation
 * Layer 2: Memoized computations from primitives
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IDerivedStore } from '../../program/interfaces/store'
import DerivedModel from '../models/Derived'

// Simple hash function for dependency change detection
function hashDependencies(ids: string[]): string {
  return ids.sort().join(',')
}

export function createDerivedStore(db: Database): IDerivedStore {
  const collection = db.get<DerivedModel>('derived')

  return {
    async getById(id: string): Promise<{ id: string; type: string; data: unknown } | null> {
      try {
        const model = await collection.find(id)
        return {
          id: model.id,
          type: model.type,
          data: model.data,
        }
      } catch {
        return null
      }
    },

    async getByType(type: string): Promise<Array<{ id: string; type: string; data: unknown }>> {
      const models = await collection
        .query(Q.where('type', type), Q.where('stale', false))
        .fetch()
      return models.map((m) => ({
        id: m.id,
        type: m.type,
        data: m.data,
      }))
    },

    async getStale(): Promise<Array<{ id: string; type: string }>> {
      const models = await collection
        .query(Q.where('stale', true))
        .fetch()
      return models.map((m) => ({
        id: m.id,
        type: m.type,
      }))
    },

    async create(type: string, dependencyIds: string[], data: unknown): Promise<{ id: string }> {
      const model = await db.write(() =>
        collection.create((d) => {
          d.type = type
          d.dependencyIdsJson = JSON.stringify(dependencyIds)
          d.dependencyHash = hashDependencies(dependencyIds)
          d.dataJson = JSON.stringify(data)
          d.stale = false
          d.computedAt = Date.now()
        })
      )
      return { id: model.id }
    },

    async markStale(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((d) => {
            d.stale = true
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async markStaleByDependency(primitiveId: string): Promise<number> {
      // Find all derived that depend on this primitive
      const all = await collection.query().fetch()
      let count = 0

      for (const model of all) {
        const deps = model.dependencyIds
        if (deps.includes(primitiveId) && !model.stale) {
          await db.write(() =>
            model.update((d) => {
              d.stale = true
            })
          )
          count++
        }
      }

      return count
    },

    async recompute(id: string, data: unknown): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((d) => {
            d.dataJson = JSON.stringify(data)
            d.stale = false
            d.computedAt = Date.now()
          })
        )
      } catch {
        // Ignore errors
      }
    },
  }
}
