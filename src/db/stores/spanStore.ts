/**
 * Span Store - WatermelonDB Implementation
 * Layer 1: Text regions matched by extractors
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { ISpanStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Span, CreateSpan } from '../../program/schemas/primitives'
import SpanModel from '../models/Span'

export function createSpanStore(db: Database): ISpanStore {
  const collection = db.get<SpanModel>('spans')

  return {
    async getById(id: string): Promise<Span | null> {
      try {
        const model = await collection.find(id)
        return modelToSpan(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Span[]> {
      const models = await collection.query().fetch()
      return models.map(modelToSpan)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateSpan): Promise<Span> {
      const model = await db.write(() =>
        collection.create((s) => {
          s.conversationId = data.conversationId
          s.charStart = data.charStart
          s.charEnd = data.charEnd
          s.textExcerpt = data.textExcerpt
          s.matchedBy = data.matchedBy
          s.patternId = data.patternId || null
          s.createdAt = data.createdAt
        })
      )
      return modelToSpan(model)
    },

    async update(): Promise<Span | null> {
      // Spans are immutable
      return null
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

    async getByConversation(conversationId: string): Promise<Span[]> {
      const models = await collection
        .query(Q.where('conversationId', conversationId), Q.sortBy('charStart', Q.asc))
        .fetch()
      return models.map(modelToSpan)
    },

    async getByPattern(patternId: string): Promise<Span[]> {
      const models = await collection
        .query(Q.where('patternId', patternId))
        .fetch()
      return models.map(modelToSpan)
    },

    subscribe(callback: SubscriptionCallback<Span>): Unsubscribe {
      const subscription = collection
        .query(Q.sortBy('createdAt', Q.desc))
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToSpan))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToSpan(model: SpanModel): Span {
  return {
    id: model.id,
    conversationId: model.conversationId,
    charStart: model.charStart,
    charEnd: model.charEnd,
    textExcerpt: model.textExcerpt,
    matchedBy: model.matchedBy as Span['matchedBy'],
    patternId: model.patternId || undefined,
    createdAt: model.createdAt,
  }
}
