/**
 * Pattern Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Pattern extends Model {
  static table = 'patterns'

  @text('patternType') patternType!: string
  @text('description') description!: string
  @text('evidenceClaimsJson') evidenceClaimsJson!: string // JSON array of claim IDs
  @field('occurrenceCount') occurrenceCount!: number
  @field('confidence') confidence!: number
  @field('createdAt') createdAt!: number
  @field('lastObserved') lastObserved!: number
}
