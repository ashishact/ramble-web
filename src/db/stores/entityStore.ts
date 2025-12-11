/**
 * Entity Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IEntityStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Entity, CreateEntity, UpdateEntity } from '../../program/types'
import EntityModel from '../models/Entity'

export function createEntityStore(db: Database): IEntityStore {
  const collection = db.get<EntityModel>('entities')

  return {
    async getById(id: string): Promise<Entity | null> {
      try {
        const model = await collection.find(id)
        return modelToEntity(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Entity[]> {
      const models = await collection.query().fetch()
      return models.map(modelToEntity)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateEntity): Promise<Entity> {
      const model = await db.write(() =>
        collection.create((entity) => {
          entity.canonicalName = data.canonicalName
          entity.entityType = data.entityType
          entity.aliases = data.aliases
          entity.createdAt = Date.now()
          entity.lastReferenced = Date.now()
          entity.mentionCount = data.mentionCount
        })
      )
      return modelToEntity(model)
    },

    async update(id: string, data: UpdateEntity): Promise<Entity | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((entity) => {
          if (data.canonicalName !== undefined) entity.canonicalName = data.canonicalName
          if (data.entityType !== undefined) entity.entityType = data.entityType
          if (data.aliases !== undefined) entity.aliases = data.aliases
          if (Date.now() !== undefined) entity.lastReferenced = Date.now()
          if (data.mentionCount !== undefined) entity.mentionCount = data.mentionCount
        })
        return modelToEntity(updated)
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

    async getByName(name: string): Promise<Entity | null> {
      const models = await collection.query(Q.where('canonicalName', name)).fetch()
      return models.length > 0 ? modelToEntity(models[0]) : null
    },

    async getByType(type: string): Promise<Entity[]> {
      const models = await collection.query(Q.where('entityType', type)).fetch()
      return models.map(modelToEntity)
    },

    async findByAlias(alias: string): Promise<Entity | null> {
      // Search through aliases JSON
      const allModels = await collection.query().fetch()
      for (const model of allModels) {
        const aliases = JSON.parse(model.aliases || '[]')
        if (aliases.includes(alias)) {
          return modelToEntity(model)
        }
      }
      return null
    },

    async incrementMentionCount(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((entity) => {
          entity.mentionCount = (entity.mentionCount || 0) + 1
        })
      } catch {
        // Ignore errors
      }
    },

    async updateLastReferenced(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((entity) => {
          entity.lastReferenced = Date.now()
        })
      } catch {
        // Ignore errors
      }
    },

    async mergeEntities(keepId: string, deleteId: string): Promise<Entity | null> {
      try {
        const keepModel = await collection.find(keepId)
        const deleteModel = await collection.find(deleteId)

        const keepAliases = JSON.parse(keepModel.aliases || '[]')
        const deleteAliases = JSON.parse(deleteModel.aliases || '[]')

        const merged = await keepModel.update((entity) => {
          // Merge aliases
          const allAliases = [...new Set([...keepAliases, deleteModel.canonicalName, ...deleteAliases])]
          entity.aliases = JSON.stringify(allAliases)
          // Combine mention counts
          entity.mentionCount = (entity.mentionCount || 0) + (deleteModel.mentionCount || 0)
          // Update last referenced
          entity.lastReferenced = Math.max(entity.lastReferenced, deleteModel.lastReferenced)
        })

        await deleteModel.destroyPermanently()
        return modelToEntity(merged)
      } catch {
        return null
      }
    },

    subscribe(callback: SubscriptionCallback<Entity>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToEntity))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToEntity(model: EntityModel): Entity {
  return {
    id: model.id,
    canonicalName: model.canonicalName,
    entityType: model.entityType,
    aliases: model.aliases,
    createdAt: model.createdAt,
    lastReferenced: model.lastReferenced,
    mentionCount: model.mentionCount,
  }
}
