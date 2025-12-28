/**
 * Stance Store - WatermelonDB Implementation
 * Layer 1: How propositions are held
 */

import type { Database } from '@nozbe/watermelondb'
import { Q } from '@nozbe/watermelondb'
import type { IStanceStore, SubscriptionCallback, Unsubscribe } from '../../program/interfaces/store'
import type { Stance, CreateStance } from '../../program/schemas/primitives'
import StanceModel from '../models/Stance'

export function createStanceStore(db: Database): IStanceStore {
  const collection = db.get<StanceModel>('stances')

  return {
    async getById(id: string): Promise<Stance | null> {
      try {
        const model = await collection.find(id)
        return modelToStance(model)
      } catch {
        return null
      }
    },

    async getAll(): Promise<Stance[]> {
      const models = await collection.query().fetch()
      return models.map(modelToStance)
    },

    async count(): Promise<number> {
      return collection.query().fetchCount()
    },

    async create(data: CreateStance): Promise<Stance> {
      const model = await db.write(() =>
        collection.create((s) => {
          s.propositionId = data.propositionId
          s.holder = data.holder
          // Epistemic
          s.epistemicCertainty = data.epistemic.certainty
          s.epistemicEvidence = data.epistemic.evidence
          // Volitional
          s.volitionalValence = data.volitional.valence
          s.volitionalStrength = data.volitional.strength
          s.volitionalType = data.volitional.type || null
          // Deontic
          s.deonticStrength = data.deontic.strength
          s.deonticSource = data.deontic.source || null
          s.deonticType = data.deontic.type || null
          // Affective
          s.affectiveValence = data.affective.valence
          s.affectiveArousal = data.affective.arousal
          s.emotionsJson = data.affective.emotions ? JSON.stringify(data.affective.emotions) : null
          // Meta
          s.expressedAt = data.expressedAt
          s.supersedes = data.supersedes || null
        })
      )
      return modelToStance(model)
    },

    async update(id: string, data: Partial<Stance>): Promise<Stance | null> {
      try {
        const model = await collection.find(id)
        const updated = await db.write(() =>
          model.update((s) => {
            if (data.epistemic) {
              if (data.epistemic.certainty !== undefined) s.epistemicCertainty = data.epistemic.certainty
              if (data.epistemic.evidence !== undefined) s.epistemicEvidence = data.epistemic.evidence
            }
            if (data.volitional) {
              if (data.volitional.valence !== undefined) s.volitionalValence = data.volitional.valence
              if (data.volitional.strength !== undefined) s.volitionalStrength = data.volitional.strength
              if (data.volitional.type !== undefined) s.volitionalType = data.volitional.type || null
            }
            if (data.deontic) {
              if (data.deontic.strength !== undefined) s.deonticStrength = data.deontic.strength
              if (data.deontic.source !== undefined) s.deonticSource = data.deontic.source || null
              if (data.deontic.type !== undefined) s.deonticType = data.deontic.type || null
            }
            if (data.affective) {
              if (data.affective.valence !== undefined) s.affectiveValence = data.affective.valence
              if (data.affective.arousal !== undefined) s.affectiveArousal = data.affective.arousal
              if (data.affective.emotions !== undefined) {
                s.emotionsJson = data.affective.emotions ? JSON.stringify(data.affective.emotions) : null
              }
            }
            if (data.supersedes !== undefined) s.supersedes = data.supersedes || null
          })
        )
        return modelToStance(updated)
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

    async getByProposition(propositionId: string): Promise<Stance[]> {
      const models = await collection
        .query(Q.where('propositionId', propositionId))
        .fetch()
      return models.map(modelToStance)
    },

    async getByHolder(holder: string): Promise<Stance[]> {
      const models = await collection
        .query(Q.where('holder', holder))
        .fetch()
      return models.map(modelToStance)
    },

    async getRecent(limit: number): Promise<Stance[]> {
      const models = await collection
        .query(Q.sortBy('expressedAt', Q.desc), Q.take(limit))
        .fetch()
      return models.map(modelToStance)
    },

    subscribe(callback: SubscriptionCallback<Stance>): Unsubscribe {
      const subscription = collection
        .query(Q.sortBy('expressedAt', Q.desc))
        .observe()
        .subscribe((models) => {
          callback(models.map(modelToStance))
        })

      return () => subscription.unsubscribe()
    },
  }
}

function modelToStance(model: StanceModel): Stance {
  return {
    id: model.id,
    propositionId: model.propositionId,
    holder: model.holder,
    epistemic: {
      certainty: model.epistemicCertainty,
      evidence: model.epistemicEvidence as Stance['epistemic']['evidence'],
    },
    volitional: {
      valence: model.volitionalValence,
      strength: model.volitionalStrength,
      type: (model.volitionalType || undefined) as Stance['volitional']['type'],
    },
    deontic: {
      strength: model.deonticStrength,
      source: (model.deonticSource || undefined) as Stance['deontic']['source'],
      type: (model.deonticType || undefined) as Stance['deontic']['type'],
    },
    affective: {
      valence: model.affectiveValence,
      arousal: model.affectiveArousal,
      emotions: model.emotions.length > 0 ? model.emotions : undefined,
    },
    expressedAt: model.expressedAt,
    supersedes: model.supersedes || undefined,
  }
}
