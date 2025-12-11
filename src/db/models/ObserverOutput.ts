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
  @text('sessionId') sessionId!: string | null
  @field('createdAt') createdAt!: number
}
