/**
 * SynthesisCache Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class SynthesisCache extends Model {
  static table = 'synthesis_cache'

  @text('synthesisType') synthesisType!: string
  @text('cacheKey') cacheKey!: string
  @text('contentJson') contentJson!: string
  @text('sourceClaimsJson') sourceClaimsJson!: string
  @field('ttlSeconds') ttlSeconds!: number
  @field('createdAt') createdAt!: number
  @field('stale') stale!: boolean
}
