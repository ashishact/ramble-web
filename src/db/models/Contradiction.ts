/**
 * Contradiction Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Contradiction extends Model {
  static table = 'contradictions'

  @text('claimAId') claimAId!: string
  @text('claimBId') claimBId!: string
  @text('resolutionType') resolutionType?: string
  @text('resolutionExplanation') resolutionExplanation?: string
  @field('resolved') resolved!: boolean
  @field('createdAt') createdAt!: number
  @field('resolvedAt') resolvedAt?: number
}
