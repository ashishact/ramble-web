/**
 * Correction Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { ICorrectionStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Correction, CreateCorrection, UpdateCorrection } from '../../program/types'
import CorrectionModel from '../models/Correction'

export function createCorrectionStore(db: Database): ICorrectionStore {
  const collection = db.get<CorrectionModel>('corrections')

  return {
    async getById(id: string): Promise<Correction | null> {
      try {
        const model = await collection.find(id)
        return modelToCorrection(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Correction[]> {
      const models = await collection.query().fetch()
      return models.map(modelToCorrection)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateCorrection): Promise<Correction> {
      const model = await db.write(() =>
        collection.create((correction) => {
          correction.wrongText = data.wrongText
          correction.correctText = data.correctText
          correction.originalCase = data.originalCase
          correction.usageCount = data.usageCount
          correction.createdAt = data.createdAt
          correction.lastUsed = data.lastUsed
        })
      )
      return modelToCorrection(model)
    },

    async update(id: string, data: UpdateCorrection): Promise<Correction | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((correction) => {
          if (data.wrongText !== undefined) correction.wrongText = data.wrongText
          if (data.correctText !== undefined) correction.correctText = data.correctText
          if (data.originalCase !== undefined) correction.originalCase = data.originalCase
          if (data.usageCount !== undefined) correction.usageCount = data.usageCount
          if (data.lastUsed !== undefined) correction.lastUsed = data.lastUsed
        })
        return modelToCorrection(updated)
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

    async getByWrongText(wrongText: string): Promise<Correction | null> {
      const models = await collection.query(Q.where('wrongText', wrongText)).fetch()
      return models.length > 0 ? modelToCorrection(models[0]) : null
    },

    async getFrequentlyUsed(limit: number): Promise<Correction[]> {
      const models = await collection
        .query(Q.sortBy('usageCount', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToCorrection)
    },

    async incrementUsageCount(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((correction) => {
          correction.usageCount = (correction.usageCount || 0) + 1
        })
      } catch {
        // Ignore errors
      }
    },

    async updateLastUsed(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((correction) => {
          correction.lastUsed = Date.now()
        })
      } catch {
        // Ignore errors
      }
    },

    subscribe(callback: SubscriptionCallback<Correction>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToCorrection))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToCorrection(model: CorrectionModel): Correction {
  return {
    id: model.id,
    wrongText: model.wrongText,
    correctText: model.correctText,
    originalCase: model.originalCase,
    usageCount: model.usageCount,
    createdAt: model.createdAt,
    lastUsed: model.lastUsed || null,
  }
}
