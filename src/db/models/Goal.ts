/**
 * Goal Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Goal extends Model {
  static table = 'goals'

  @text('statement') statement!: string
  @text('goalType') goalType!: string
  @text('timeframe') timeframe!: string
  @text('status') status!: string
  @field('progressValue') progressValue!: number
  @text('priority') priority!: string
  @field('createdAt') createdAt!: number
  @field('achievedAt') achievedAt!: number | null
  @text('parentGoalId') parentGoalId!: string | null
}
