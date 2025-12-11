/**
 * Conversation Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IConversationStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { ConversationUnit, CreateConversationUnit, UpdateConversationUnit } from '../../program/types'
import ConversationModel from '../models/Conversation'

export function createConversationStore(db: Database): IConversationStore {
  const collection = db.get<ConversationModel>('conversations')

  return {
    async getById(id: string): Promise<ConversationUnit | null> {
      try {
        const model = await collection.find(id)
        return modelToConversation(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<ConversationUnit[]> {
      const models = await collection.query().fetch()
      return models.map(modelToConversation)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateConversationUnit): Promise<ConversationUnit> {
      const now = Date.now()
      const model = await db.write(() =>
        collection.create((conversation) => {
          conversation.sessionId = data.sessionId ?? null
          conversation.timestamp = data.timestamp ?? null
          conversation.rawText = data.rawText ?? null
          conversation.sanitizedText = data.sanitizedText ?? null
          conversation.source = data.source ?? null
          conversation.precedingContextSummary = data.precedingContextSummary ?? null
          conversation.createdAt = now
          conversation.processed = data.processed || false
        })
      )
      return modelToConversation(model)
    },

    async update(id: string, data: UpdateConversationUnit): Promise<ConversationUnit | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((conversation) => {
            if (data.sanitizedText !== undefined) conversation.sanitizedText = data.sanitizedText ?? null
            if (data.precedingContextSummary !== undefined)
              conversation.precedingContextSummary = data.precedingContextSummary ?? null
            if (data.processed !== undefined) conversation.processed = data.processed ?? null
          })
        )
        return modelToConversation(updated)
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

    async getBySession(sessionId: string): Promise<ConversationUnit[]> {
      const models = await collection
        .query(Q.where('sessionId', sessionId), Q.sortBy('timestamp', Q.asc))
        .fetch()
      return models.map(modelToConversation)
    },

    async getUnprocessed(): Promise<ConversationUnit[]> {
      const models = await collection
        .query(Q.where('processed', false), Q.sortBy('createdAt', Q.asc))
        .fetch()
      return models.map(modelToConversation)
    },

    async markProcessed(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((conversation) => {
            conversation.processed = true
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async getRecent(limit: number): Promise<ConversationUnit[]> {
      const models = await collection
        .query(Q.sortBy('timestamp', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToConversation)
    },

    subscribe(sessionId: string, callback: SubscriptionCallback<ConversationUnit>): Unsubscribe {
      const subscription = collection
        .query(Q.where('sessionId', sessionId), Q.sortBy('timestamp', Q.asc))
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToConversation))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToConversation(model: ConversationModel): ConversationUnit {
  return {
    id: model.id,
    sessionId: model.sessionId,
    timestamp: model.timestamp,
    rawText: model.rawText,
    sanitizedText: model.sanitizedText,
    source: model.source as 'speech' | 'text',
    precedingContextSummary: model.precedingContextSummary,
    createdAt: model.createdAt,
    processed: model.processed,
  }
}
