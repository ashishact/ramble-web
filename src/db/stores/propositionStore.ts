/**
 * Proposition Store - WatermelonDB Implementation
 * Layer 1: What is said
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IPropositionStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Proposition, CreateProposition } from '../../program/schemas/primitives'
import PropositionModel from '../models/Proposition'

export function createPropositionStore(db: Database): IPropositionStore {
  const collection = db.get<PropositionModel>('propositions')

  return {
    async getById(id: string): Promise<Proposition | null> {
      try {
        const model = await collection.find(id)
        return modelToProposition(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Proposition[]> {
      const models = await collection.query().fetch()
      return models.map(modelToProposition)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateProposition): Promise<Proposition> {
      const model = await db.write(() =>
        collection.create((p) => {
          p.content = data.content
          p.subject = data.subject
          p.type = data.type
          p.entityIdsJson = JSON.stringify(data.entityIds)
          p.spanIdsJson = JSON.stringify(data.spanIds)
          p.conversationId = data.conversationId
          p.createdAt = data.createdAt
        })
      )
      return modelToProposition(model)
    },

    async update(id: string, data: Partial<Proposition>): Promise<Proposition | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((p) => {
            if (data.content !== undefined) p.content = data.content
            if (data.entityIds !== undefined) p.entityIdsJson = JSON.stringify(data.entityIds)
            if (data.spanIds !== undefined) p.spanIdsJson = JSON.stringify(data.spanIds)
          })
        )
        return modelToProposition(updated)
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

    async getByConversation(conversationId: string): Promise<Proposition[]> {
      const models = await collection
        .query(Q.where('conversationId', conversationId))
        .fetch()
      return models.map(modelToProposition)
    },

    async getBySubject(subject: string): Promise<Proposition[]> {
      const models = await collection
        .query(Q.where('subject', subject))
        .fetch()
      return models.map(modelToProposition)
    },

    async getByType(type: string): Promise<Proposition[]> {
      const models = await collection
        .query(Q.where('type', type))
        .fetch()
      return models.map(modelToProposition)
    },

    async getRecent(limit: number): Promise<Proposition[]> {
      const models = await collection
        .query(Q.sortBy('createdAt', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToProposition)
    },

    subscribe(callback: SubscriptionCallback<Proposition>): Unsubscribe {
      const subscription = collection
        .query(Q.sortBy('createdAt', Q.desc))
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToProposition))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToProposition(model: PropositionModel): Proposition {
  return {
    id: model.id,
    content: model.content,
    subject: model.subject,
    type: model.type as Proposition['type'],
    entityIds: model.entityIds,
    spanIds: model.spanIds,
    conversationId: model.conversationId,
    createdAt: model.createdAt,
  }
}
