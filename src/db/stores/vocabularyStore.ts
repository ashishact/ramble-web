/**
 * Vocabulary Store - WatermelonDB Implementation
 *
 * Custom vocabulary for STT entity spelling correction.
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IVocabularyStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Vocabulary, CreateVocabulary, UpdateVocabulary, VocabularyEntityType } from '../../program/schemas/vocabulary'
import { addVariantCount } from '../../program/schemas/vocabulary'
import VocabularyModel from '../models/Vocabulary'

export function createVocabularyStore(db: Database): IVocabularyStore {
  const collection = db.get<VocabularyModel>('vocabulary')

  return {
    async getById(id: string): Promise<Vocabulary | null> {
      try {
        const model = await collection.find(id)
        return modelToVocabulary(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Vocabulary[]> {
      const models = await collection.query().fetch()
      return models.map(modelToVocabulary)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateVocabulary): Promise<Vocabulary> {
      const now = Date.now()
      const model = await db.write(() =>
        collection.create((vocab) => {
          vocab.correctSpelling = data.correctSpelling
          vocab.entityType = data.entityType
          vocab.contextHints = data.contextHints
          vocab.phoneticPrimary = data.phoneticPrimary
          vocab.phoneticSecondary = data.phoneticSecondary ?? null
          vocab.usageCount = data.usageCount ?? 0
          vocab.variantCountsJson = data.variantCountsJson ?? '{}'
          vocab.createdAt = now
          vocab.lastUsed = null
          vocab.sourceEntityId = data.sourceEntityId ?? null
        })
      )
      return modelToVocabulary(model)
    },

    async update(id: string, data: UpdateVocabulary): Promise<Vocabulary | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((vocab) => {
            if (data.correctSpelling !== undefined) vocab.correctSpelling = data.correctSpelling
            if (data.entityType !== undefined) vocab.entityType = data.entityType
            if (data.contextHints !== undefined) vocab.contextHints = data.contextHints
            if (data.phoneticPrimary !== undefined) vocab.phoneticPrimary = data.phoneticPrimary
            if (data.phoneticSecondary !== undefined) vocab.phoneticSecondary = data.phoneticSecondary
            if (data.usageCount !== undefined) vocab.usageCount = data.usageCount
            if (data.variantCountsJson !== undefined) vocab.variantCountsJson = data.variantCountsJson
            if (data.lastUsed !== undefined) vocab.lastUsed = data.lastUsed
            if (data.sourceEntityId !== undefined) vocab.sourceEntityId = data.sourceEntityId
          })
        )
        return modelToVocabulary(updated)
      } catch {
        return null
      }
    },

    async delete(id: string): Promise<boolean> {
      try {
        const model = await collection.find(id)
        await db.write(() => model.destroyPermanently())
        return true
      } catch {
        return false
      }
    },

    async getByCorrectSpelling(spelling: string): Promise<Vocabulary | null> {
      const normalizedSpelling = spelling.toLowerCase().trim()
      const models = await collection.query().fetch()
      const match = models.find(
        m => m.correctSpelling.toLowerCase().trim() === normalizedSpelling
      )
      return match ? modelToVocabulary(match) : null
    },

    async getByPhoneticCode(code: string): Promise<Vocabulary[]> {
      // Search both primary and secondary phonetic codes
      const models = await collection.query(
        Q.or(
          Q.where('phoneticPrimary', code),
          Q.where('phoneticSecondary', code)
        )
      ).fetch()
      return models.map(modelToVocabulary)
    },

    async getByEntityType(type: VocabularyEntityType): Promise<Vocabulary[]> {
      const models = await collection.query(
        Q.where('entityType', type)
      ).fetch()
      return models.map(modelToVocabulary)
    },

    async getBySourceEntity(entityId: string): Promise<Vocabulary | null> {
      const models = await collection.query(
        Q.where('sourceEntityId', entityId)
      ).fetch()
      return models.length > 0 ? modelToVocabulary(models[0]) : null
    },

    async incrementUsageCount(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((vocab) => {
            vocab.usageCount = (vocab.usageCount || 0) + 1
            vocab.lastUsed = Date.now()
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async incrementVariantCount(id: string, variant: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((vocab) => {
            vocab.variantCountsJson = addVariantCount(vocab.variantCountsJson, variant)
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async getFrequentlyUsed(limit: number): Promise<Vocabulary[]> {
      const models = await collection
        .query(Q.sortBy('usageCount', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToVocabulary)
    },

    subscribe(callback: SubscriptionCallback<Vocabulary>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToVocabulary))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToVocabulary(model: VocabularyModel): Vocabulary {
  return {
    id: model.id,
    correctSpelling: model.correctSpelling,
    entityType: model.entityType as VocabularyEntityType,
    contextHints: model.contextHints,
    phoneticPrimary: model.phoneticPrimary,
    phoneticSecondary: model.phoneticSecondary,
    usageCount: model.usageCount,
    variantCountsJson: model.variantCountsJson,
    createdAt: model.createdAt,
    lastUsed: model.lastUsed,
    sourceEntityId: model.sourceEntityId,
  }
}
