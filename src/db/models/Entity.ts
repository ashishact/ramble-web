/**
 * Entity Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Entity extends Model {
  static table = 'entities'

  @text('canonicalName') canonicalName!: string
  @text('entityType') entityType!: string
  @text('aliases') aliases!: string // JSON array
  @field('createdAt') createdAt!: number
  @field('lastReferenced') lastReferenced!: number
  @field('mentionCount') mentionCount!: number
}
