/**
 * PrimitiveEntity Model - Named entities for the new layered system
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class PrimitiveEntity extends Model {
  static table = 'primitive_entities'

  @text('canonicalName') canonicalName!: string
  @text('type') type!: string
  @text('aliases') aliases!: string // JSON array
  @text('firstSpanId') firstSpanId!: string
  @field('mentionCount') mentionCount!: number
  @field('lastMentioned') lastMentioned!: number
  @field('createdAt') createdAt!: number
}
