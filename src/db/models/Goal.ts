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
  @text('parentGoalId') parentGoalId!: string | null
  @field('createdAt') createdAt!: number
  @field('lastReferenced') lastReferenced!: number
  @field('achievedAt') achievedAt!: number | null
  @field('priority') priority!: number
  @text('progressType') progressType!: string
  @field('progressValue') progressValue!: number
  @text('progressIndicatorsJson') progressIndicatorsJson!: string
  @text('blockersJson') blockersJson!: string
  @text('sourceClaimId') sourceClaimId!: string
  @text('motivation') motivation!: string | null
  @field('deadline') deadline!: number | null
}
