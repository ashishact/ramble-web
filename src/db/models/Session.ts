/**
 * Session Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Session extends Model {
  static table = 'sessions'

  @field('startedAt') startedAt!: number
  @field('endedAt') endedAt!: number | null
  @field('unitCount') unitCount!: number
  @text('summary') summary!: string | null
  @text('moodTrajectoryJson') moodTrajectoryJson!: string | null
}
