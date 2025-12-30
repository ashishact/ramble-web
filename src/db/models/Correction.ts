import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class Correction extends Model {
  static table = 'corrections'

  @field('wrongText') wrongText!: string
  @field('correctText') correctText!: string
  @field('originalCase') originalCase!: string
  @field('usageCount') usageCount!: number
  @field('createdAt') createdAt!: number
  @field('lastUsed') lastUsed?: number
  @field('sourceConversationId') sourceConversationId?: string
}
