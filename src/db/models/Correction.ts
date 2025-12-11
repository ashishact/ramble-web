/**
 * Correction Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Correction extends Model {
  static table = 'corrections'

  @text('wrongText') wrongText!: string
  @text('correctText') correctText!: string
  @text('originalCase') originalCase!: string
  @field('usageCount') usageCount!: number
  @field('createdAt') createdAt!: number
  @field('lastUsed') lastUsed!: number
  @text('sourceUnitId') sourceUnitId!: string | null
}
