import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export default class Task extends Model {
  static table = 'tasks'

  @field('taskType') taskType!: string
  @field('status') status!: TaskStatus
  @field('priority') priority!: number
  @field('payload') payload!: string  // JSON
  @field('result') result?: string  // JSON
  @field('attempts') attempts!: number
  @field('maxAttempts') maxAttempts!: number
  @field('lastError') lastError?: string
  @field('checkpoint') checkpoint?: string  // JSON
  @field('createdAt') createdAt!: number
  @field('startedAt') startedAt?: number
  @field('completedAt') completedAt?: number
  @field('scheduledAt') scheduledAt!: number
  @field('sessionId') sessionId?: string

  get payloadParsed(): Record<string, unknown> {
    try {
      return JSON.parse(this.payload || '{}')
    } catch {
      return {}
    }
  }

  get resultParsed(): Record<string, unknown> | null {
    if (!this.result) return null
    try {
      return JSON.parse(this.result)
    } catch {
      return null
    }
  }

  get checkpointParsed(): Record<string, unknown> | null {
    if (!this.checkpoint) return null
    try {
      return JSON.parse(this.checkpoint)
    } catch {
      return null
    }
  }
}
