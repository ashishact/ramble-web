/**
 * Value Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Value extends Model {
  static table = 'values'

  @text('statement') statement!: string
  @text('domain') domain!: string
  @field('importance') importance!: number
  @text('sourceClaimId') sourceClaimId!: string
  @field('createdAt') createdAt!: number
}
