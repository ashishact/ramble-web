/**
 * ExtractionProgram Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type {
  IExtractionProgramStore,
  SubscriptionCallback,
  Unsubscribe,
} from '../../program/interfaces/store'
import type { ExtractionProgram, CreateExtractionProgram, UpdateExtractionProgram, LLMTier } from '../../program/types'
import ExtractionProgramModel from '../models/ExtractionProgram'

export function createExtractionProgramStore(db: Database): IExtractionProgramStore {
  const collection = db.get<ExtractionProgramModel>('extraction_programs')

  return {
    async getById(id: string): Promise<ExtractionProgram | null> {
      try {
        const model = await collection.find(id)
        return modelToExtractionProgram(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<ExtractionProgram[]> {
      const models = await collection.query().fetch()
      return models.map(modelToExtractionProgram)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateExtractionProgram): Promise<ExtractionProgram> {
      const now = Date.now()
      const model = await db.write(() =>
        collection.create((program) => {
          program.name = data.name
          program.description = data.description
          program.type = data.type
          program.version = data.version ?? 1
          program.active = data.active ?? true
          program.patternsJson = data.patternsJson
          program.alwaysRun = data.alwaysRun
          program.promptTemplate = data.promptTemplate
          program.outputSchemaJson = data.outputSchemaJson
          program.llmTier = data.llmTier
          program.llmTemperature = data.llmTemperature ?? undefined
          program.llmMaxTokens = data.llmMaxTokens ?? undefined
          program.priority = data.priority
          program.minConfidence = data.minConfidence
          program.isCore = data.isCore ?? false
          program.claimTypesJson = data.claimTypesJson
          program.createdAt = now
          program.updatedAt = now
          program.runCount = data.runCount ?? 0
          program.successRate = data.successRate ?? 0
          program.avgProcessingTimeMs = data.avgProcessingTimeMs ?? 0
        })
      )
      return modelToExtractionProgram(model)
    },

    async update(id: string, data: UpdateExtractionProgram): Promise<ExtractionProgram | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((program) => {
          if (data.name !== undefined) program.name = data.name
          if (data.description !== undefined) program.description = data.description
          if (data.active !== undefined) program.active = data.active
          if (data.patternsJson !== undefined) program.patternsJson = data.patternsJson
          if (data.promptTemplate !== undefined) program.promptTemplate = data.promptTemplate
          if (data.outputSchemaJson !== undefined) program.outputSchemaJson = data.outputSchemaJson
          if (data.llmTier !== undefined) program.llmTier = data.llmTier
          if (data.priority !== undefined) program.priority = data.priority
          if (Date.now() !== undefined) program.lastUsed = Date.now()
          if (data.runCount !== undefined) program.runCount = data.runCount
          if (data.successRate !== undefined) program.successRate = data.successRate
        })
        return modelToExtractionProgram(updated)
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

    async getActive(): Promise<ExtractionProgram[]> {
      const models = await collection
        .query(Q.where('active', true), Q.sortBy('priority', Q.desc))
        .fetch()
      return models.map(modelToExtractionProgram)
    },

    async getByType(type: string): Promise<ExtractionProgram[]> {
      const models = await collection.query(Q.where('type', type)).fetch()
      return models.map(modelToExtractionProgram)
    },

    async getCore(): Promise<ExtractionProgram[]> {
      // Core programs are typically the first few by priority
      const models = await collection
        .query(Q.where('active', true), Q.sortBy('priority', Q.desc), Q.take(10))
        .fetch()
      return models.map(modelToExtractionProgram)
    },

    async incrementRunCount(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((program) => {
          program.runCount = (program.runCount || 0) + 1
          program.lastUsed = Date.now()
        })
      } catch {
        // Ignore errors
      }
    },

    async updateSuccessRate(id: string, success: boolean): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((program) => {
          const totalRuns = program.runCount || 0
          const currentSuccessRate = program.successRate || 0
          const successfulRuns = Math.round(currentSuccessRate * totalRuns)
          const newSuccessfulRuns = success ? successfulRuns + 1 : successfulRuns
          program.successRate = totalRuns > 0 ? newSuccessfulRuns / (totalRuns + 1) : success ? 1 : 0
        })
      } catch {
        // Ignore errors
      }
    },

    async updateProcessingTime(id: string, timeMs: number): Promise<void> {
      // Note: Schema doesn't have processingTime field
      // This is a no-op for now
    },

    subscribe(callback: SubscriptionCallback<ExtractionProgram>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToExtractionProgram))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToExtractionProgram(model: ExtractionProgramModel): ExtractionProgram {
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    type: model.type,
    version: model.version,
    patternsJson: model.patternsJson,
    alwaysRun: model.alwaysRun,
    llmTier: model.llmTier as LLMTier,
    llmTemperature: model.llmTemperature ?? null,
    llmMaxTokens: model.llmMaxTokens ?? null,
    promptTemplate: model.promptTemplate,
    outputSchemaJson: model.outputSchemaJson,
    priority: model.priority,
    active: model.active,
    minConfidence: model.minConfidence,
    isCore: model.isCore,
    claimTypesJson: model.claimTypesJson,
    successRate: model.successRate,
    runCount: model.runCount,
    avgProcessingTimeMs: model.avgProcessingTimeMs,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  }
}
