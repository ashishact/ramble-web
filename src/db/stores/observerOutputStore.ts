/**
 * ObserverOutput Store - WatermelonDB Implementation
 *
 * This store manages observer outputs and their related entities:
 * - Contradictions
 * - Patterns
 * - Values
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IObserverOutputStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type {
  ObserverOutput,
  CreateObserverOutput,
  UpdateObserverOutput,
  Contradiction,
  CreateContradiction,
  Pattern,
  CreatePattern,
  Value,
  CreateValue,
} from '../../program/types'
import ObserverOutputModel from '../models/ObserverOutput'
import ContradictionModel from '../models/Contradiction'
import PatternModel from '../models/Pattern'
import ValueModel from '../models/Value'

export function createObserverOutputStore(db: Database): IObserverOutputStore {
  const collection = db.get<ObserverOutputModel>('observer_outputs')
  const contradictionsCollection = db.get<ContradictionModel>('contradictions')
  const patternsCollection = db.get<PatternModel>('patterns')
  const valuesCollection = db.get<ValueModel>('values')

  return {
    async getById(id: string): Promise<ObserverOutput | null> {
      try {
        const model = await collection.find(id)
        return modelToObserverOutput(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<ObserverOutput[]> {
      const models = await collection.query().fetch()
      return models.map(modelToObserverOutput)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateObserverOutput): Promise<ObserverOutput> {
      const model = await db.write(() =>
        collection.create((output) => {
          output.observerType = data.observerType
          output.outputType = data.outputType
          output.contentJson = data.contentJson
          output.sourceClaimsJson = data.sourceClaimsJson
          output.createdAt = Date.now()
          output.sessionId = data.sessionId
        })
      )
      return modelToObserverOutput(model)
    },

    async update(id: string, data: UpdateObserverOutput): Promise<ObserverOutput | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((output) => {
            if (data.contentJson !== undefined) output.contentJson = data.contentJson
            if (data.sourceClaimsJson !== undefined) output.sourceClaimsJson = data.sourceClaimsJson
          })
        )
        return modelToObserverOutput(updated)
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

    async getByType(type: string): Promise<ObserverOutput[]> {
      const models = await collection.query(Q.where('outputType', type)).fetch()
      return models.map(modelToObserverOutput)
    },

    async getRecent(limit: number): Promise<ObserverOutput[]> {
      const models = await collection
        .query(Q.sortBy('createdAt', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToObserverOutput)
    },

    async markStale(_id: string): Promise<void> {
      // Note: ObserverOutput doesn't have stale field in schema
      // This is a no-op for now
    },

    subscribe(callback: SubscriptionCallback<ObserverOutput>): Unsubscribe {
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToObserverOutput))
        })

      return () => subscription.unsubscribe()
    },

    // Contradictions sub-store
    async addContradiction(data: CreateContradiction): Promise<Contradiction> {
      const model = await db.write(() =>
        contradictionsCollection.create((contradiction) => {
          contradiction.claimAId = data.claimAId
          contradiction.claimBId = data.claimBId
          contradiction.createdAt = Date.now()
          contradiction.resolved = data.resolved ?? false
          contradiction.resolutionType = data.resolutionType ?? null
          contradiction.resolutionExplanation = data.resolutionNotes ?? null
          contradiction.resolvedAt = data.resolvedAt ?? null
        })
      )
      return modelToContradiction(model)
    },

    async getContradictions(): Promise<Contradiction[]> {
      const models = await contradictionsCollection.query().fetch()
      return models.map(modelToContradiction)
    },

    async getUnresolvedContradictions(): Promise<Contradiction[]> {
      const models = await contradictionsCollection.query(Q.where('resolved', false)).fetch()
      return models.map(modelToContradiction)
    },

    async resolveContradiction(
      id: string,
      resolutionType: string,
      notes: string | null
    ): Promise<Contradiction | null> {
      try {
        const model = await contradictionsCollection.find(id)
        const updated = await db.write(() =>
          model.update((contradiction) => {
            contradiction.resolutionType = resolutionType
            contradiction.resolutionExplanation = notes || null
            contradiction.resolved = true
            contradiction.resolvedAt = Date.now()
          })
        )
        return modelToContradiction(updated)
      } catch {
        return null
      }
    },

    // Patterns sub-store
    async addPattern(data: CreatePattern): Promise<Pattern> {
      const now = Date.now()
      const model = await db.write(() =>
        patternsCollection.create((pattern) => {
          pattern.patternType = data.patternType
          pattern.description = data.description
          pattern.evidenceClaimsJson = data.evidenceClaimsJson
          pattern.createdAt = now
          pattern.lastObserved = now
          pattern.occurrenceCount = data.occurrenceCount ?? 1
          pattern.confidence = data.confidence
        })
      )
      return modelToPattern(model)
    },

    async getPatterns(): Promise<Pattern[]> {
      const models = await patternsCollection.query().fetch()
      return models.map(modelToPattern)
    },

    async reinforcePattern(id: string): Promise<void> {
      try {
        const model = await patternsCollection.find(id)
        await db.write(() =>
          model.update((pattern) => {
            pattern.occurrenceCount = (pattern.occurrenceCount || 0) + 1
            pattern.confidence = Math.min(1.0, pattern.confidence + 0.05)
            pattern.lastObserved = Date.now()
          })
        )
      } catch {
        // Ignore errors
      }
    },

    // Values sub-store
    async addValue(data: CreateValue): Promise<Value> {
      const now = Date.now()
      const model = await db.write(() =>
        valuesCollection.create((value) => {
          value.statement = data.statement
          value.domain = data.domain
          value.importance = data.importance
          value.sourceClaimId = data.sourceClaimId
          value.createdAt = now
        })
      )
      return modelToValue(model)
    },

    async getValues(): Promise<Value[]> {
      const models = await valuesCollection.query().fetch()
      return models.map(modelToValue)
    },

    async confirmValue(id: string): Promise<void> {
      try {
        const model = await valuesCollection.find(id)
        await db.write(() =>
          model.update((value) => {
            value.importance = Math.min(1.0, value.importance + 0.1)
          })
        )
      } catch {
        // Ignore errors
      }
    },
  }
}

function modelToObserverOutput(model: ObserverOutputModel): ObserverOutput {
  return {
    id: model.id,
    observerType: model.observerType as ObserverOutput['observerType'],
    outputType: model.outputType,
    contentJson: model.contentJson,
    sourceClaimsJson: model.sourceClaimsJson,
    createdAt: model.createdAt,
    sessionId: model.sessionId,
  }
}

function modelToContradiction(model: ContradictionModel): Contradiction {
  return {
    id: model.id,
    claimAId: model.claimAId,
    claimBId: model.claimBId,
    detectedAt: model.createdAt, // Map createdAt -> detectedAt
    contradictionType: 'direct', // Default, not stored in DB
    resolved: model.resolved,
    resolutionType: model.resolutionType || null,
    resolutionNotes: model.resolutionExplanation || null, // Map resolutionExplanation -> resolutionNotes
    resolvedAt: model.resolvedAt || null,
  }
}

function modelToPattern(model: PatternModel): Pattern {
  return {
    id: model.id,
    patternType: model.patternType,
    description: model.description,
    evidenceClaimsJson: model.evidenceClaimsJson,
    firstDetected: model.createdAt, // Map createdAt -> firstDetected
    lastDetected: model.lastObserved, // Map lastObserved -> lastDetected
    occurrenceCount: model.occurrenceCount,
    confidence: model.confidence,
  }
}

function modelToValue(model: ValueModel): Value {
  return {
    id: model.id,
    statement: model.statement,
    domain: model.domain,
    importance: model.importance,
    sourceClaimId: model.sourceClaimId,
    firstExpressed: model.createdAt, // Map createdAt -> firstExpressed
    lastConfirmed: model.createdAt, // Default to createdAt (not stored)
    confirmationCount: 1, // Default (not stored in DB)
  }
}
