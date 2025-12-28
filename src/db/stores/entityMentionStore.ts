/**
 * EntityMention Store - WatermelonDB Implementation
 * Layer 1: Raw entity references in text
 */

import type { Database, Collection } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type EntityMentionModel from '../models/EntityMention'
import type { IEntityMentionStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { EntityMention, CreateEntityMention } from '../../program/schemas/primitives'

function modelToEntityMention(model: EntityMentionModel): EntityMention {
  return {
    id: model.id,
    text: model.text,
    mentionType: model.mentionType as EntityMention['mentionType'],
    suggestedType: model.suggestedType as EntityMention['suggestedType'],
    spanId: model.spanId,
    conversationId: model.conversationId,
    resolvedEntityId: model.resolvedEntityId,
    createdAt: model.createdAt,
  }
}

export function createEntityMentionStore(db: Database): IEntityMentionStore {
  const collection = db.get<EntityMentionModel>('entity_mentions') as Collection<EntityMentionModel>

  return {
    async getById(id: string): Promise<EntityMention | null> {
      try {
        const model = await collection.find(id)
        return modelToEntityMention(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<EntityMention[]> {
      const models = await collection.query().fetch()
      return models.map(modelToEntityMention)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateEntityMention): Promise<EntityMention> {
      const created = await db.write(async () => {
        return collection.create((record) => {
          record.text = data.text
          record.mentionType = data.mentionType
          record.suggestedType = data.suggestedType
          record.spanId = data.spanId
          record.conversationId = data.conversationId
          record.resolvedEntityId = data.resolvedEntityId
          record.createdAt = data.createdAt
        })
      })
      return modelToEntityMention(created)
    },

    async update(id: string, data: Partial<EntityMention>): Promise<EntityMention | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(async () => {
          return model.update((record) => {
            if (data.text !== undefined) record.text = data.text
            if (data.mentionType !== undefined) record.mentionType = data.mentionType
            if (data.suggestedType !== undefined) record.suggestedType = data.suggestedType
            if (data.spanId !== undefined) record.spanId = data.spanId
            if (data.conversationId !== undefined) record.conversationId = data.conversationId
            if (data.resolvedEntityId !== undefined) record.resolvedEntityId = data.resolvedEntityId
          })
        })
        return modelToEntityMention(updated)
      } catch {
        return null
      }
    },

    async delete(id: string): Promise<boolean> {
      try {
        const model = await collection.find(id)
        await db.write(async () => {
          await model.destroyPermanently()
        })
        return true
      } catch {
        return false
      }
    },

    async getByConversation(conversationId: string): Promise<EntityMention[]> {
      const models = await collection
        .query(Q.where('conversationId', conversationId))
        .fetch()
      return models.map(modelToEntityMention)
    },

    async getByResolvedEntity(entityId: string): Promise<EntityMention[]> {
      const models = await collection
        .query(Q.where('resolvedEntityId', entityId))
        .fetch()
      return models.map(modelToEntityMention)
    },

    async getUnresolved(): Promise<EntityMention[]> {
      const models = await collection
        .query(Q.where('resolvedEntityId', null))
        .fetch()
      return models.map(modelToEntityMention)
    },

    async getRecent(limit: number): Promise<EntityMention[]> {
      const models = await collection
        .query(Q.sortBy('createdAt', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToEntityMention)
    },

    async resolve(id: string, entityId: string): Promise<EntityMention | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(async () => {
          return model.update((record) => {
            record.resolvedEntityId = entityId
          })
        })
        return modelToEntityMention(updated)
      } catch {
        return null
      }
    },

    subscribe(callback: SubscriptionCallback<EntityMention>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToEntityMention))
        })
      return () => subscription.unsubscribe()
    },
  }
}
