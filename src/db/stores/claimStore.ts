/**
 * Claim Store - WatermelonDB Implementation
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IClaimStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type {
  Claim,
  CreateClaim,
  UpdateClaim,
  ClaimSource,
  CreateClaimSource,
  ClaimState,
  ClaimType,
  MemoryTier,
} from '../../program/types'
import ClaimModel from '../models/Claim'
import ClaimSourceModel from '../models/ClaimSource'

export function createClaimStore(db: Database): IClaimStore {
  const collection = db.get<ClaimModel>('claims')
  const claimSourcesCollection = db.get<ClaimSourceModel>('claim_sources')

  return {
    async getById(id: string): Promise<Claim | null> {
      try {
        const model = await collection.find(id)
        return modelToClaim(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Claim[]> {
      const models = await collection.query().fetch()
      return models.map(modelToClaim)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateClaim): Promise<Claim> {
      const model = await db.write(() =>
        collection.create((claim) => {
          claim.statement = data.statement
          claim.subject = data.subject
          claim.claimType = data.claimType
          claim.temporality = data.temporality
          claim.abstraction = data.abstraction
          claim.sourceType = data.sourceType
          claim.initialConfidence = data.initialConfidence
          claim.currentConfidence = data.currentConfidence
          claim.state = data.state
          claim.emotionalValence = data.emotionalValence
          claim.emotionalIntensity = data.emotionalIntensity
          claim.stakes = data.stakes
          claim.validFrom = data.validFrom
          claim.validUntil = data.validUntil
          claim.createdAt = data.createdAt
          claim.lastConfirmed = data.lastConfirmed
          claim.confirmationCount = data.confirmationCount
          claim.extractionProgramId = data.extractionProgramId
          claim.supersededBy = data.supersededBy
          claim.elaborates = data.elaborates
          claim.memoryTier = data.memoryTier
          claim.salience = data.salience
          claim.promotedAt = data.promotedAt
          claim.lastAccessed = data.lastAccessed
        })
      )
      return modelToClaim(model)
    },

    async update(id: string, data: UpdateClaim): Promise<Claim | null> {
      try {
        const model = await collection.find(id)
        const updated = await model.update((claim) => {
          if (data.statement !== undefined) claim.statement = data.statement
          if (data.currentConfidence !== undefined) claim.currentConfidence = data.currentConfidence
          if (data.state !== undefined) claim.state = data.state
          if (data.emotionalValence !== undefined) claim.emotionalValence = data.emotionalValence
          if (data.emotionalIntensity !== undefined) claim.emotionalIntensity = data.emotionalIntensity
          if (data.validUntil !== undefined) claim.validUntil = data.validUntil
          if (data.lastConfirmed !== undefined) claim.lastConfirmed = data.lastConfirmed
          if (data.confirmationCount !== undefined) claim.confirmationCount = data.confirmationCount
          if (data.supersededBy !== undefined) claim.supersededBy = data.supersededBy
          if (data.memoryTier !== undefined) claim.memoryTier = data.memoryTier
          if (data.salience !== undefined) claim.salience = data.salience
          if (data.promotedAt !== undefined) claim.promotedAt = data.promotedAt
          if (data.lastAccessed !== undefined) claim.lastAccessed = data.lastAccessed
        })
        return modelToClaim(updated)
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

    async getByState(state: ClaimState): Promise<Claim[]> {
      const models = await collection.query(Q.where('state', state)).fetch()
      return models.map(modelToClaim)
    },

    async getByType(type: ClaimType): Promise<Claim[]> {
      const models = await collection.query(Q.where('claimType', type)).fetch()
      return models.map(modelToClaim)
    },

    async getBySubject(subject: string): Promise<Claim[]> {
      const models = await collection.query(Q.where('subject', subject)).fetch()
      return models.map(modelToClaim)
    },

    async getBySession(sessionId: string): Promise<Claim[]> {
      // Get all claim sources for this session's units
      const conversationsCollection = db.get('conversations')
      const conversations = await conversationsCollection
        .query(Q.where('sessionId', sessionId))
        .fetch()

      const unitIds = conversations.map((c: any) => c.id)
      if (unitIds.length === 0) return []

      const claimSources = await claimSourcesCollection
        .query(Q.where('unitId', Q.oneOf(unitIds)))
        .fetch()

      const claimIds = [...new Set(claimSources.map((cs: any) => cs.claimId))]
      if (claimIds.length === 0) return []

      const models = await collection.query(Q.where('id', Q.oneOf(claimIds))).fetch()
      return models.map(modelToClaim)
    },

    async getRecent(limit: number): Promise<Claim[]> {
      const models = await collection
        .query(Q.sortBy('createdAt', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToClaim)
    },

    async confirmClaim(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.lastConfirmed = Date.now()
          claim.confirmationCount = (claim.confirmationCount || 0) + 1
          claim.currentConfidence = Math.min(1.0, claim.currentConfidence + 0.1)
        })
      } catch {
        // Ignore errors
      }
    },

    async supersedeClaim(id: string, newClaimId: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.supersededBy = newClaimId
          claim.state = 'superseded'
        })
      } catch {
        // Ignore errors
      }
    },

    async decayConfidence(id: string, factor: number): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.currentConfidence = Math.max(0, claim.currentConfidence * factor)
        })
      } catch {
        // Ignore errors
      }
    },

    subscribe(sessionId: string, callback: SubscriptionCallback<Claim>): Unsubscribe {
      // For session-specific claims, we need to query through claim_sources
      // This is a simplified version - in production you'd want to optimize this
      const subscription = collection
        .query()
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToClaim))
        })

      return () => subscription.unsubscribe()
    },

    // Claim sources (many-to-many)
    async addSource(data: CreateClaimSource): Promise<ClaimSource> {
      const model = await db.write(() =>
        claimSourcesCollection.create((cs: any) => {
          cs.claimId = data.claimId
          cs.unitId = data.unitId
        })
      )
      return {
        id: model.id,
        claimId: (model as any).claimId,
        unitId: (model as any).unitId,
      }
    },

    async getSourcesForClaim(claimId: string): Promise<ClaimSource[]> {
      const models = await claimSourcesCollection.query(Q.where('claimId', claimId)).fetch()
      return models.map((m: any) => ({
        id: m.id,
        claimId: m.claimId,
        unitId: m.unitId,
      }))
    },

    async getSourcesForUnit(unitId: string): Promise<ClaimSource[]> {
      const models = await claimSourcesCollection.query(Q.where('unitId', unitId)).fetch()
      return models.map((m: any) => ({
        id: m.id,
        claimId: m.claimId,
        unitId: m.unitId,
      }))
    },

    // Memory system methods
    async getByMemoryTier(tier: MemoryTier): Promise<Claim[]> {
      const models = await collection
        .query(Q.where('memoryTier', tier), Q.sortBy('salience', Q.desc))
        .fetch()
      return models.map(modelToClaim)
    },

    async getDecayable(): Promise<Claim[]> {
      const models = await collection.query(Q.where('state', Q.notEq('eternal'))).fetch()
      return models.map(modelToClaim)
    },

    async updateSalience(id: string, salience: number): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.salience = salience
        })
      } catch {
        // Ignore errors
      }
    },

    async updateLastAccessed(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.lastAccessed = Date.now()
        })
      } catch {
        // Ignore errors
      }
    },

    async promoteToLongTerm(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.memoryTier = 'long_term'
          claim.promotedAt = Date.now()
        })
      } catch {
        // Ignore errors
      }
    },

    async markStale(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.state = 'stale'
        })
      } catch {
        // Ignore errors
      }
    },

    async markDormant(id: string): Promise<void> {
      try {
        const model = await collection.find(id)
        await model.update((claim) => {
          claim.state = 'dormant'
        })
      } catch {
        // Ignore errors
      }
    },
  }
}

function modelToClaim(model: ClaimModel): Claim {
  return {
    id: model.id,
    statement: model.statement,
    subject: model.subject,
    claimType: model.claimType as ClaimType,
    temporality: model.temporality,
    abstraction: model.abstraction,
    sourceType: model.sourceType,
    initialConfidence: model.initialConfidence,
    currentConfidence: model.currentConfidence,
    state: model.state as ClaimState,
    emotionalValence: model.emotionalValence,
    emotionalIntensity: model.emotionalIntensity,
    stakes: model.stakes,
    validFrom: model.validFrom,
    validUntil: model.validUntil || null,
    createdAt: model.createdAt,
    lastConfirmed: model.lastConfirmed,
    confirmationCount: model.confirmationCount,
    extractionProgramId: model.extractionProgramId,
    supersededBy: model.supersededBy || null,
    elaborates: model.elaborates || null,
    memoryTier: model.memoryTier as MemoryTier,
    salience: model.salience,
    promotedAt: model.promotedAt || null,
    lastAccessed: model.lastAccessed,
  }
}
