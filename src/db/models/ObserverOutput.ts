/**
 * ObserverOutput Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class ObserverOutput extends Model {
  static table = 'observer_outputs'

  @text('observerType') observerType!: string
  @text('outputType') outputType!: string
  @text('contentJson') contentJson!: string
  @text('sourceClaimsJson') sourceClaimsJson!: string
  @field('stale') stale!: boolean
  @text('sessionId') sessionId?: string
  @field('createdAt') createdAt!: number
}
