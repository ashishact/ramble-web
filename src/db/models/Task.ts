/**
 * Task Model
 *
 * Durable task queue - tasks are persisted to enable recovery after browser reload
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Task extends Model {
  static table = 'tasks'

  @text('taskType') taskType!: string
  @text('status') status!: string
  @text('priority') priority!: string  // 'critical' | 'high' | 'normal' | 'low'
  @field('priorityValue') priorityValue!: number  // Numeric for sorting
  @text('payloadJson') payloadJson!: string
  @field('attempts') attempts!: number
  @field('maxAttempts') maxAttempts!: number
  @text('lastError') lastError!: string | null
  @field('lastErrorAt') lastErrorAt!: number | null
  @text('backoffConfigJson') backoffConfigJson!: string
  @text('checkpointJson') checkpointJson!: string | null
  @field('createdAt') createdAt!: number
  @field('startedAt') startedAt!: number | null
  @field('completedAt') completedAt!: number | null
  @field('executeAt') executeAt!: number
  @field('nextRetryAt') nextRetryAt!: number | null
  @text('groupId') groupId!: string | null
  @text('dependsOn') dependsOn!: string | null
  @text('sessionId') sessionId!: string | null
}
