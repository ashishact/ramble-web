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
      const model = await db.write(() =>
        collection.create((program) => {
          program.name = data.name
          program.type = data.type
          program.description = data.description
          program.active = data.active
          program.triggers = data.triggers
          program.llmTier = data.llmTier
          program.promptTemplate = data.promptTemplate
          program.outputSchemaJson = data.outputSchemaJson
          program.createdAt = Date.now()
        })
      )
      return modelToObserverProgram(model)
    },

    async update(id: string, data: UpdateObserverProgram): Promise<ObserverProgram | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((program) => {
          if (data.name !== undefined) program.name = data.name
          if (data.description !== undefined) program.description = data.description
          if (data.active !== undefined) program.active = data.active
          if (data.triggers !== undefined) program.triggers = data.triggers
          if (data.llmTier !== undefined) program.llmTier = data.llmTier
          if (data.promptTemplate !== undefined) program.promptTemplate = data.promptTemplate
          if (data.outputSchemaJson !== undefined) program.outputSchemaJson = data.outputSchemaJson
        })
        return modelToObserverProgram(updated)
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
      // Note: Schema doesn't have runCount field for observer programs
      // This is a no-op for now
    },

    async updateSuccessRate(id: string, success: boolean): Promise<void> {
      // Note: Schema doesn't have successRate field for observer programs
      // This is a no-op for now
    },

    async updateProcessingTime(id: string, timeMs: number): Promise<void> {
      // Note: Schema doesn't have processingTime field
      // This is a no-op for now
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
    triggers: model.triggers,
    llmTier: model.llmTier || null,
    promptTemplate: model.promptTemplate || null,
    outputSchemaJson: model.outputSchemaJson || null,
    createdAt: model.createdAt,
  }
}
