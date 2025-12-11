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
import type { ExtractionProgram, CreateExtractionProgram, UpdateExtractionProgram } from '../../program/types'
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
      const model = await db.write(() =>
        collection.create((program) => {
          program.name = data.name
          program.description = data.description
          program.type = data.type
          program.version = data.version
          program.active = data.active
          program.patternsJson = data.patternsJson
          program.promptTemplate = data.promptTemplate
          program.outputSchemaJson = data.outputSchemaJson
          program.llmTier = data.llmTier
          program.priority = data.priority
          program.createdAt = Date.now()
          program.lastUsed = Date.now()
          program.runCount = data.runCount
          program.successRate = data.successRate
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
    type: model.type as 'pattern' | 'llm',
    version: model.version,
    active: model.active,
    patternsJson: model.patternsJson || null,
    promptTemplate: model.promptTemplate || null,
    outputSchemaJson: model.outputSchemaJson || null,
    llmTier: model.llmTier || null,
    priority: model.priority,
    createdAt: model.createdAt,
    lastUsed: model.lastUsed || null,
    runCount: model.runCount,
    successRate: model.successRate,
  }
}
