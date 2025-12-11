/**
 * ObserverProgram Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type {
  IObserverProgramStore,
  SubscriptionCallback,
  Unsubscribe,
} from '../../program/interfaces/store'
import type { ObserverProgram, CreateObserverProgram, UpdateObserverProgram, ObserverType } from '../../program/types'
import { parseTriggers, serializeTriggers } from '../../program/schemas/observerProgram'
import type { LLMTier } from '../../program/types/llmTiers'
import ObserverProgramModel from '../models/ObserverProgram'

export function createObserverProgramStore(db: Database): IObserverProgramStore {
  const collection = db.get<ObserverProgramModel>('observer_programs')

  return {
    async getById(id: string): Promise<ObserverProgram | null> {
      try {
        const model = await collection.find(id)
        return modelToObserverProgram(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<ObserverProgram[]> {
      const models = await collection.query().fetch()
      return models.map(modelToObserverProgram)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateObserverProgram): Promise<ObserverProgram> {
      const now = Date.now()
      const model = await db.write(() =>
        collection.create((program) => {
          program.name = data.name
          program.type = data.type
          program.description = data.description
          program.active = data.active ?? true
          program.priority = data.priority ?? 0
          program.triggers = serializeTriggers(data.triggers)
          program.claimTypeFilter = data.claimTypeFilter ?? null
          program.usesLlm = data.usesLlm ?? false
          program.llmTier = data.llmTier ?? null
          program.llmTemperature = data.llmTemperature ?? null
          program.llmMaxTokens = data.llmMaxTokens ?? null
          program.promptTemplate = data.promptTemplate ?? null
          program.outputSchemaJson = data.outputSchemaJson ?? null
          program.shouldRunLogic = data.shouldRunLogic ?? null
          program.processLogic = data.processLogic ?? null
          program.isCore = data.isCore ?? false
          program.version = data.version ?? 1
          program.createdAt = now
          program.updatedAt = now
          program.runCount = data.runCount ?? 0
          program.successRate = data.successRate ?? 0
          program.avgProcessingTimeMs = data.avgProcessingTimeMs ?? 0
        })
      )
      return modelToObserverProgram(model)
    },

    async update(id: string, data: UpdateObserverProgram): Promise<ObserverProgram | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((program) => {
            if (data.name !== undefined) program.name = data.name
            if (data.description !== undefined) program.description = data.description
            if (data.active !== undefined) program.active = data.active
            if (data.priority !== undefined) program.priority = data.priority
            if (data.triggers !== undefined) program.triggers = serializeTriggers(data.triggers)
            if (data.claimTypeFilter !== undefined) program.claimTypeFilter = data.claimTypeFilter
            if (data.usesLlm !== undefined) program.usesLlm = data.usesLlm
            if (data.llmTier !== undefined) program.llmTier = data.llmTier
            if (data.llmTemperature !== undefined) program.llmTemperature = data.llmTemperature
            if (data.llmMaxTokens !== undefined) program.llmMaxTokens = data.llmMaxTokens
            if (data.promptTemplate !== undefined) program.promptTemplate = data.promptTemplate
            if (data.outputSchemaJson !== undefined) program.outputSchemaJson = data.outputSchemaJson
            if (data.shouldRunLogic !== undefined) program.shouldRunLogic = data.shouldRunLogic
            if (data.processLogic !== undefined) program.processLogic = data.processLogic
            program.updatedAt = Date.now()
          })
        )
        return modelToObserverProgram(updated)
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

    async getActive(): Promise<ObserverProgram[]> {
      const models = await collection.query(Q.where('active', true)).fetch()
      return models.map(modelToObserverProgram)
    },

    async getByType(type: ObserverType): Promise<ObserverProgram | null> {
      const models = await collection.query(Q.where('type', type), Q.take(1)).fetch()
      return models.length > 0 ? modelToObserverProgram(models[0]) : null
    },

    async getCore(): Promise<ObserverProgram[]> {
      const models = await collection.query(Q.where('active', true), Q.take(10)).fetch()
      return models.map(modelToObserverProgram)
    },

    async incrementRunCount(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((program) => {
            program.runCount = (program.runCount || 0) + 1
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async updateSuccessRate(id: string, success: boolean): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((program) => {
            const totalRuns = program.runCount || 0
            const currentSuccessRate = program.successRate || 0
            const successfulRuns = Math.round(currentSuccessRate * totalRuns)
            const newSuccessfulRuns = success ? successfulRuns + 1 : successfulRuns
            program.successRate = totalRuns > 0 ? newSuccessfulRuns / (totalRuns + 1) : success ? 1 : 0
          })
        )
      } catch {
        // Ignore errors
      }
    },

    async updateProcessingTime(id: string, timeMs: number): Promise<void> {
      try {
        const model = await collection.find(id)
        await db.write(() =>
          model.update((program) => {
            const currentAvg = program.avgProcessingTimeMs || 0
            const runCount = program.runCount || 0
            // Calculate running average
            program.avgProcessingTimeMs = runCount > 0
              ? (currentAvg * (runCount - 1) + timeMs) / runCount
              : timeMs
          })
        )
      } catch {
        // Ignore errors
      }
    },

    subscribe(callback: SubscriptionCallback<ObserverProgram>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToObserverProgram))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToObserverProgram(model: ObserverProgramModel): ObserverProgram {
  return {
    id: model.id,
    name: model.name,
    type: model.type as ObserverType,
    description: model.description,
    active: model.active,
    priority: model.priority,
    triggers: parseTriggers(model.triggers),
    claimTypeFilter: model.claimTypeFilter || null,
    usesLlm: model.usesLlm,
    llmTier: (model.llmTier as LLMTier) || null,
    llmTemperature: model.llmTemperature ?? null,
    llmMaxTokens: model.llmMaxTokens ?? null,
    promptTemplate: model.promptTemplate || null,
    outputSchemaJson: model.outputSchemaJson || null,
    shouldRunLogic: model.shouldRunLogic || null,
    processLogic: model.processLogic || null,
    isCore: model.isCore,
    version: model.version,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    runCount: model.runCount,
    successRate: model.successRate,
    avgProcessingTimeMs: model.avgProcessingTimeMs,
  }
}
