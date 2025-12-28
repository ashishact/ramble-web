/**
 * Relation Store - WatermelonDB Implementation
 * Layer 1: How propositions connect
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IRelationStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Relation, CreateRelation } from '../../program/schemas/primitives'
import PropositionRelationModel from '../models/PropositionRelation'

export function createRelationStore(db: Database): IRelationStore {
  const collection = db.get<PropositionRelationModel>('relations')

  return {
    async getById(id: string): Promise<Relation | null> {
      try {
        const model = await collection.find(id)
        return modelToRelation(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Relation[]> {
      const models = await collection.query().fetch()
      return models.map(modelToRelation)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateRelation): Promise<Relation> {
      const model = await db.write(() =>
        collection.create((r) => {
          r.sourceId = data.sourceId
          r.targetId = data.targetId
          r.category = data.category
          r.subtype = data.subtype
          r.strength = data.strength
          r.spanIdsJson = JSON.stringify(data.spanIds)
          r.createdAt = data.createdAt
        })
      )
      return modelToRelation(model)
    },

    async update(id: string, data: Partial<Relation>): Promise<Relation | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((r) => {
            if (data.strength !== undefined) r.strength = data.strength
            if (data.spanIds !== undefined) r.spanIdsJson = JSON.stringify(data.spanIds)
          })
        )
        return modelToRelation(updated)
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

    async getBySource(sourceId: string): Promise<Relation[]> {
      const models = await collection
        .query(Q.where('sourceId', sourceId))
        .fetch()
      return models.map(modelToRelation)
    },

    async getByTarget(targetId: string): Promise<Relation[]> {
      const models = await collection
        .query(Q.where('targetId', targetId))
        .fetch()
      return models.map(modelToRelation)
    },

    async getByCategory(category: string): Promise<Relation[]> {
      const models = await collection
        .query(Q.where('category', category))
        .fetch()
      return models.map(modelToRelation)
    },

    subscribe(callback: SubscriptionCallback<Relation>): Unsubscribe {
      const subscription = collection
        .query(Q.sortBy('createdAt', Q.desc))
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToRelation))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToRelation(model: PropositionRelationModel): Relation {
  return {
    id: model.id,
    sourceId: model.sourceId,
    targetId: model.targetId,
    category: model.category as Relation['category'],
    subtype: model.subtype,
    strength: model.strength,
    spanIds: model.spanIds,
    createdAt: model.createdAt,
  }
}
