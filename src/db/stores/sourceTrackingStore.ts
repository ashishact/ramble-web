/**
 * SourceTracking Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { ISourceTrackingStore } from '../../program/interfaces/store'
import type { SourceTracking, CreateSourceTracking } from '../../program/types'
import SourceTrackingModel from '../models/SourceTracking'

export function createSourceTrackingStore(db: Database): ISourceTrackingStore {
  const collection = db.get<SourceTrackingModel>('source_tracking')

  return {
    async getById(id: string): Promise<SourceTracking | null> {
      try {
        const model = await collection.find(id)
        return modelToSourceTracking(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<SourceTracking[]> {
      const models = await collection.query().fetch()
      return models.map(modelToSourceTracking)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateSourceTracking): Promise<SourceTracking> {
      const model = await db.write(() =>
        collection.create((st) => {
          st.claimId = data.claimId
          st.unitId = data.unitId
          st.unitText = data.unitText
          st.textExcerpt = data.textExcerpt
          st.charStart = data.charStart
          st.charEnd = data.charEnd
          st.patternId = data.patternId
          st.llmPrompt = data.llmPrompt
          st.llmResponse = data.llmResponse
          st.createdAt = data.createdAt
        })
      )
      return modelToSourceTracking(model)
    },

    async update(): Promise<SourceTracking | null> {
      // SourceTracking is immutable - no updates allowed
      return null
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

    async getByClaimId(claimId: string): Promise<SourceTracking | null> {
      const models = await collection.query(Q.where('claimId', claimId), Q.take(1)).fetch()
      return models.length > 0 ? modelToSourceTracking(models[0]) : null
    },

    async getByUnitId(unitId: string): Promise<SourceTracking[]> {
      const models = await collection.query(Q.where('unitId', unitId)).fetch()
      return models.map(modelToSourceTracking)
    },

    async deleteByClaimId(claimId: string): Promise<boolean> {
      try {
        const models = await collection.query(Q.where('claimId', claimId)).fetch()
        await db.write(async () => {
          for (const model of models) {
            await model.destroyPermanently()
          }
        })
        return true
      } catch {
        return false
      }
    },
  }
}

function modelToSourceTracking(model: SourceTrackingModel): SourceTracking {
  return {
    id: model.id,
    claimId: model.claimId,
    unitId: model.unitId,
    unitText: model.unitText,
    textExcerpt: model.textExcerpt,
    charStart: model.charStart || null,
    charEnd: model.charEnd || null,
    patternId: model.patternId || null,
    llmPrompt: model.llmPrompt,
    llmResponse: model.llmResponse,
    createdAt: model.createdAt,
  }
}
