/**
 * Contradiction Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Contradiction extends Model {
  static table = 'contradictions'

  @text('claimAId') claimAId!: string
  @text('claimBId') claimBId!: string
  @field('detectedAt') detectedAt!: number
  @text('contradictionType') contradictionType!: string
  @field('resolved') resolved!: boolean
  @text('resolutionType') resolutionType?: string
  @text('resolutionNotes') resolutionNotes?: string
  @field('resolvedAt') resolvedAt?: number
}
