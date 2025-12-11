/**
 * SynthesisCache Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { ISynthesisCacheStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { SynthesisCache, CreateSynthesisCache, UpdateSynthesisCache } from '../../program/types'
import SynthesisCacheModel from '../models/SynthesisCache'

export function createSynthesisCacheStore(db: Database): ISynthesisCacheStore {
  const collection = db.get<SynthesisCacheModel>('synthesis_cache')

  return {
    async getById(id: string): Promise<SynthesisCache | null> {
      try {
        const model = await collection.find(id)
        return modelToSynthesisCache(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<SynthesisCache[]> {
      const models = await collection.query().fetch()
      return models.map(modelToSynthesisCache)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateSynthesisCache): Promise<SynthesisCache> {
      const model = await db.write(() =>
        collection.create((cache) => {
          cache.synthesisType = data.synthesisType
          cache.cacheKey = data.cacheKey
          cache.contentJson = data.contentJson
          cache.sourceClaimsJson = data.sourceClaimsJson
          cache.ttlSeconds = data.ttlSeconds
          cache.createdAt = data.createdAt
          cache.stale = data.stale
        })
      )
      return modelToSynthesisCache(model)
    },

    async update(id: string, data: UpdateSynthesisCache): Promise<SynthesisCache | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((cache) => {
          if (data.contentJson !== undefined) cache.contentJson = data.contentJson
          if (data.sourceClaimsJson !== undefined) cache.sourceClaimsJson = data.sourceClaimsJson
          if (data.stale !== undefined) cache.stale = data.stale
        })
        return modelToSynthesisCache(updated)
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

    async getByType(type: string): Promise<SynthesisCache[]> {
      const models = await collection.query(Q.where('synthesisType', type)).fetch()
      return models.map(modelToSynthesisCache)
    },

    async getByCacheKey(key: string): Promise<SynthesisCache | null> {
      const models = await collection.query(Q.where('cacheKey', key), Q.take(1)).fetch()
      return models.length > 0 ? modelToSynthesisCache(models[0]) : null
    },

    async getValid(type: string): Promise<SynthesisCache[]> {
      const now = Date.now()
      const allModels = await collection.query(Q.where('synthesisType', type), Q.where('stale', false)).fetch()

      // Filter expired entries
      return allModels
        .filter((model) => {
          const expiresAt = model.createdAt + model.ttlSeconds * 1000
          return expiresAt > now
        })
        .map(modelToSynthesisCache)
    },

    async markStale(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((cache) => {
          cache.stale = true
        })
      } catch {
        // Ignore errors
      }
    },

    async cleanupExpired(): Promise<number> {
      const now = Date.now()
      const allModels = await collection.query().fetch()

      let deletedCount = 0

      await db.write(async () => {
        for (const model of allModels) {
          const expiresAt = model.createdAt + model.ttlSeconds * 1000
          if (expiresAt <= now || model.stale) {
            await model.destroyPermanently()
            deletedCount++
          }
        }
      })

      return deletedCount
    },

    subscribe(callback: SubscriptionCallback<SynthesisCache>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToSynthesisCache))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToSynthesisCache(model: SynthesisCacheModel): SynthesisCache {
  return {
    id: model.id,
    synthesisType: model.synthesisType,
    cacheKey: model.cacheKey,
    contentJson: model.contentJson,
    sourceClaimsJson: model.sourceClaimsJson,
    ttlSeconds: model.ttlSeconds,
    createdAt: model.createdAt,
    stale: model.stale,
  }
}
