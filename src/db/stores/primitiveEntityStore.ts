/**
 * Primitive Entity Store - WatermelonDB Implementation
 * Layer 1: Named things referenced in utterances
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IPrimitiveEntityStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { PrimitiveEntity, CreatePrimitiveEntity } from '../../program/schemas/primitives'
import PrimitiveEntityModel from '../models/PrimitiveEntity'

export function createPrimitiveEntityStore(db: Database): IPrimitiveEntityStore {
  const collection = db.get<PrimitiveEntityModel>('primitive_entities')

  return {
    async getById(id: string): Promise<PrimitiveEntity | null> {
      try {
        const model = await collection.find(id)
        return modelToPrimitiveEntity(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<PrimitiveEntity[]> {
      const models = await collection.query().fetch()
      return models.map(modelToPrimitiveEntity)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreatePrimitiveEntity): Promise<PrimitiveEntity> {
      const model = await db.write(() =>
        collection.create((e) => {
          e.canonicalName = data.canonicalName
          e.type = data.type
          e.aliases = JSON.stringify(data.aliases)
          e.firstSpanId = data.firstSpanId || ''
          e.mentionCount = data.mentionCount || 1
          e.createdAt = data.createdAt
          e.lastMentioned = data.lastMentioned || data.createdAt
        })
      )
      return modelToPrimitiveEntity(model)
    },

    async update(id: string, data: Partial<PrimitiveEntity>): Promise<PrimitiveEntity | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((e) => {
            if (data.canonicalName !== undefined) e.canonicalName = data.canonicalName
            if (data.type !== undefined) e.type = data.type
            if (data.aliases !== undefined) e.aliases = JSON.stringify(data.aliases)
            if (data.firstSpanId !== undefined) e.firstSpanId = data.firstSpanId
            if (data.mentionCount !== undefined) e.mentionCount = data.mentionCount
            if (data.lastMentioned !== undefined) e.lastMentioned = data.lastMentioned
          })
        )
        return modelToPrimitiveEntity(updated)
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

    async getByName(name: string): Promise<PrimitiveEntity | null> {
      const models = await collection
        .query(Q.where('canonicalName', Q.like(`%${name}%`)))
        .fetch()

      // Find exact match first
      const exact = models.find(
        m => m.canonicalName.toLowerCase() === name.toLowerCase()
      )
      if (exact) return modelToPrimitiveEntity(exact)

      // Check aliases
      for (const model of models) {
        const aliases = parseAliases(model.aliases)
        if (aliases.some((a: string) => a.toLowerCase() === name.toLowerCase())) {
          return modelToPrimitiveEntity(model)
        }
      }

      return null
    },

    async getByType(type: string): Promise<PrimitiveEntity[]> {
      const models = await collection
        .query(Q.where('type', type))
        .fetch()
      return models.map(modelToPrimitiveEntity)
    },

    async getRecent(limit: number): Promise<PrimitiveEntity[]> {
      const models = await collection
        .query(Q.sortBy('lastMentioned', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToPrimitiveEntity)
    },

    subscribe(callback: SubscriptionCallback<PrimitiveEntity>): Unsubscribe {
      const subscription = collection
        .query(Q.sortBy('lastMentioned', Q.desc))
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToPrimitiveEntity))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function parseAliases(aliases: string): string[] {
  try {
    const parsed = JSON.parse(aliases)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function modelToPrimitiveEntity(model: PrimitiveEntityModel): PrimitiveEntity {
  return {
    id: model.id,
    canonicalName: model.canonicalName,
    type: model.type as PrimitiveEntity['type'],
    aliases: parseAliases(model.aliases),
    attributes: {},
    firstSpanId: model.firstSpanId,
    mentionCount: model.mentionCount,
    lastMentioned: model.lastMentioned,
    createdAt: model.createdAt,
  }
}
