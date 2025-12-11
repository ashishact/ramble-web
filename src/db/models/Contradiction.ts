/**
 * Contradiction Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Contradiction extends Model {
  static table = 'contradictions'

  @text('claimAId') claimAId!: string
  @text('claimBId') claimBId!: string
  @text('resolutionType') resolutionType!: string | null
  @text('resolutionExplanation') resolutionExplanation!: string | null
  @field('resolved') resolved!: boolean
  @field('createdAt') createdAt!: number
  @field('resolvedAt') resolvedAt!: number | null
}
