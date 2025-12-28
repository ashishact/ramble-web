/**
 * ExtractionTrace Store - WatermelonDB Implementation
 *
 * Stores debug/trace information for extractions.
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import ExtractionTrace from '../models/ExtractionTrace'

export interface CreateExtractionTrace {
  targetType: string
  targetId: string
  conversationId: string
  inputText: string
  spanId?: string | null
  charStart?: number | null
  charEnd?: number | null
  matchedPattern?: string | null
  matchedText?: string | null
  llmPrompt?: string | null
  llmResponse?: string | null
  llmModel?: string | null
  llmTokensUsed?: number | null
  processingTimeMs: number
  extractorId?: string | null
  error?: string | null
}

export interface ExtractionTraceRecord {
  id: string
  targetType: string
  targetId: string
  conversationId: string
  inputText: string
  spanId: string | null
  charStart: number | null
  charEnd: number | null
  matchedPattern: string | null
  matchedText: string | null
  llmPrompt: string | null
  llmResponse: string | null
  llmModel: string | null
  llmTokensUsed: number | null
  processingTimeMs: number
  extractorId: string | null
  error: string | null
  createdAt: number
}

export interface IExtractionTraceStore {
  getById(id: string): Promise<ExtractionTraceRecord | null>
  getByTargetId(targetId: string): Promise<ExtractionTraceRecord[]>
  getByConversation(conversationId: string): Promise<ExtractionTraceRecord[]>
  getByType(targetType: string): Promise<ExtractionTraceRecord[]>
  getRecent(limit: number): Promise<ExtractionTraceRecord[]>
  create(data: CreateExtractionTrace): Promise<ExtractionTraceRecord>
  delete(id: string): Promise<boolean>
  deleteByConversation(conversationId: string): Promise<number>
}

export function createExtractionTraceStore(db: Database): IExtractionTraceStore {
  const collection = db.get<ExtractionTrace>('extraction_traces')

  function modelToRecord(model: ExtractionTrace): ExtractionTraceRecord {
    return {
      id: model.id,
      targetType: model.targetType,
      targetId: model.targetId,
      conversationId: model.conversationId,
      inputText: model.inputText,
      spanId: model.spanId,
      charStart: model.charStart,
      charEnd: model.charEnd,
      matchedPattern: model.matchedPattern,
      matchedText: model.matchedText,
      llmPrompt: model.llmPrompt,
      llmResponse: model.llmResponse,
      llmModel: model.llmModel,
      llmTokensUsed: model.llmTokensUsed,
      processingTimeMs: model.processingTimeMs,
      extractorId: model.extractorId,
      error: model.error,
      createdAt: model.createdAt,
    }
  }

  return {
    async getById(id: string): Promise<ExtractionTraceRecord | null> {
      try {
        const model = await collection.find(id)
        return modelToRecord(model)
      } catch {
        return null
      }
    },

    async getByTargetId(targetId: string): Promise<ExtractionTraceRecord[]> {
      const models = await collection.query(Q.where('targetId', targetId)).fetch()
      return models.map(modelToRecord)
    },

    async getByConversation(conversationId: string): Promise<ExtractionTraceRecord[]> {
      const models = await collection
        .query(Q.where('conversationId', conversationId), Q.sortBy('createdAt', Q.desc))
        .fetch()
      return models.map(modelToRecord)
    },

    async getByType(targetType: string): Promise<ExtractionTraceRecord[]> {
      const models = await collection
        .query(Q.where('targetType', targetType), Q.sortBy('createdAt', Q.desc))
        .fetch()
      return models.map(modelToRecord)
    },

    async getRecent(limit: number): Promise<ExtractionTraceRecord[]> {
      const models = await collection
        .query(Q.sortBy('createdAt', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToRecord)
    },

    async create(data: CreateExtractionTrace): Promise<ExtractionTraceRecord> {
      const model = await db.write(() =>
        collection.create((trace) => {
          trace.targetType = data.targetType
          trace.targetId = data.targetId
          trace.conversationId = data.conversationId
          trace.inputText = data.inputText
          trace.spanId = data.spanId ?? null
          trace.charStart = data.charStart ?? null
          trace.charEnd = data.charEnd ?? null
          trace.matchedPattern = data.matchedPattern ?? null
          trace.matchedText = data.matchedText ?? null
          trace.llmPrompt = data.llmPrompt ?? null
          trace.llmResponse = data.llmResponse ?? null
          trace.llmModel = data.llmModel ?? null
          trace.llmTokensUsed = data.llmTokensUsed ?? null
          trace.processingTimeMs = data.processingTimeMs
          trace.extractorId = data.extractorId ?? null
          trace.error = data.error ?? null
          trace.createdAt = Date.now()
        })
      )
      return modelToRecord(model)
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

    async deleteByConversation(conversationId: string): Promise<number> {
      const models = await collection.query(Q.where('conversationId', conversationId)).fetch()
      await db.write(async () => {
        for (const model of models) {
          await model.destroyPermanently()
        }
      })
      return models.length
    },
  }
}
