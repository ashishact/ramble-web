/**
 * PropositionRelation Model - Layer 1: How propositions connect
 *
 * Named PropositionRelation to avoid conflict with WatermelonDB's Relation type.
 * Categories: causal, temporal, logical, teleological, compositional, contrastive, conditional
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class PropositionRelation extends Model {
  static table = 'relations'

  @text('sourceId') sourceId!: string      // Proposition ID
  @text('targetId') targetId!: string      // Proposition ID
  @text('category') category!: string      // 'causal' | 'temporal' | 'logical' | etc.
  @text('subtype') subtype!: string        // More specific (e.g., "because", "therefore")
  @field('strength') strength!: number     // 0-1
  @text('spanIdsJson') spanIdsJson!: string
  @field('createdAt') createdAt!: number

  get spanIds(): string[] {
    return JSON.parse(this.spanIdsJson || '[]')
  }
}
