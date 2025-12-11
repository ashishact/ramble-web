/**
 * Task Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Task extends Model {
  static table = 'tasks'

  @text('taskType') taskType!: string
  @text('status') status!: string
  @field('priority') priority!: number
  @text('payloadJson') payloadJson!: string
  @text('resultJson') resultJson!: string | null
  @text('errorMessage') errorMessage!: string | null
  @field('attempts') attempts!: number
  @field('maxAttempts') maxAttempts!: number
  @text('backoffConfigJson') backoffConfigJson!: string
  @text('checkpointJson') checkpointJson!: string | null
  @text('sessionId') sessionId!: string | null
  @field('createdAt') createdAt!: number
  @field('startedAt') startedAt!: number | null
  @field('completedAt') completedAt!: number | null
  @field('nextRetryAt') nextRetryAt!: number | null
}
