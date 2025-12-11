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
  @text('resultJson') resultJson?: string
  @text('errorMessage') errorMessage?: string
  @field('attempts') attempts!: number
  @field('maxAttempts') maxAttempts!: number
  @text('backoffConfigJson') backoffConfigJson!: string
  @text('checkpointJson') checkpointJson?: string
  @text('sessionId') sessionId?: string
  @field('createdAt') createdAt!: number
  @field('startedAt') startedAt?: number
  @field('completedAt') completedAt?: number
  @field('nextRetryAt') nextRetryAt?: number
}
