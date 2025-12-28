/**
 * Stance Model - Layer 1: How a proposition is held
 *
 * Four dimensions:
 * - Epistemic: How certain? What evidence?
 * - Volitional: Want vs averse? How strongly?
 * - Deontic: Obligation? From whom?
 * - Affective: Emotional valence and arousal
 */

import { Model, Relation } from '@nozbe/watermelondb'
import { field, text, relation } from '@nozbe/watermelondb/decorators'
import type Proposition from './Proposition'

export default class Stance extends Model {
  static table = 'stances'

  static associations = {
    propositions: { type: 'belongs_to', key: 'propositionId' },
  } as const

  @text('propositionId') propositionId!: string
  @text('holder') holder!: string  // 'speaker' or entity ID

  // Epistemic dimension
  @field('epistemicCertainty') epistemicCertainty!: number      // 0-1
  @text('epistemicEvidence') epistemicEvidence!: string         // 'direct' | 'inferred' | 'hearsay' | 'assumption'

  // Volitional dimension
  @field('volitionalValence') volitionalValence!: number        // -1 to 1 (averse to want)
  @field('volitionalStrength') volitionalStrength!: number      // 0-1
  @text('volitionalType') volitionalType!: string | null        // 'want' | 'intend' | 'hope' | 'fear' | 'prefer'

  // Deontic dimension
  @field('deonticStrength') deonticStrength!: number            // 0-1
  @text('deonticSource') deonticSource!: string | null          // 'self' | 'other' | 'circumstance'
  @text('deonticType') deonticType!: string | null              // 'must' | 'should' | 'may' | 'mustNot'

  // Affective dimension
  @field('affectiveValence') affectiveValence!: number          // -1 to 1
  @field('affectiveArousal') affectiveArousal!: number          // 0-1
  @text('emotionsJson') emotionsJson!: string | null

  // Meta
  @field('expressedAt') expressedAt!: number
  @text('supersedes') supersedes!: string | null

  // Relation
  @relation('propositions', 'propositionId')
  proposition!: Relation<Proposition>

  // Helpers
  get emotions(): string[] {
    return this.emotionsJson ? JSON.parse(this.emotionsJson) : []
  }

  get epistemic() {
    return {
      certainty: this.epistemicCertainty,
      evidence: this.epistemicEvidence,
    }
  }

  get volitional() {
    return {
      valence: this.volitionalValence,
      strength: this.volitionalStrength,
      type: this.volitionalType,
    }
  }

  get deontic() {
    return {
      strength: this.deonticStrength,
      source: this.deonticSource,
      type: this.deonticType,
    }
  }

  get affective() {
    return {
      valence: this.affectiveValence,
      arousal: this.affectiveArousal,
      emotions: this.emotions,
    }
  }
}
