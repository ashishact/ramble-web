/**
 * Proposition Model - Layer 1: What is said
 *
 * The content of a claim, stripped of modality ("I think", "I believe").
 * Stances attach to propositions to capture HOW they're held.
 */

import { Model, Query } from '@nozbe/watermelondb'
import { field, text, children } from '@nozbe/watermelondb/decorators'
import type Stance from './Stance'

export default class Proposition extends Model {
  static table = 'propositions'

  static associations = {
    stances: { type: 'has_many', foreignKey: 'propositionId' },
  } as const

  @text('content') content!: string
  @text('subject') subject!: string
  @text('type') type!: string  // 'state' | 'event' | 'process' | 'hypothetical' | 'generic'
  @text('entityIdsJson') entityIdsJson!: string
  @text('spanIdsJson') spanIdsJson!: string
  @text('conversationId') conversationId!: string
  @field('createdAt') createdAt!: number

  // Helpers
  get entityIds(): string[] {
    return JSON.parse(this.entityIdsJson || '[]')
  }

  get spanIds(): string[] {
    return JSON.parse(this.spanIdsJson || '[]')
  }

  @children('stances')
  stances!: Query<Stance>
}
