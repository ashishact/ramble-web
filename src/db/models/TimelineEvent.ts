import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class TimelineEvent extends Model {
  static table = 'timeline_events'

  @field('entityIds') entityIds!: string          // JSON array
  @field('eventTime') eventTime!: number          // interpreted time, NOT createdAt
  @field('timeGranularity') timeGranularity!: string  // exact|day|week|month|approximate
  @field('timeConfidence') timeConfidence!: number    // 0-1
  @field('title') title!: string
  @field('description') description!: string
  @field('significance') significance!: string | null
  @field('memoryIds') memoryIds!: string          // JSON array
  @field('source') source!: string                // user|document|meeting_other|inferred
  @field('metadata') metadata!: string            // JSON
  @field('createdAt') createdAt!: number

  get entityIdsParsed(): string[] {
    try {
      return JSON.parse(this.entityIds || '[]')
    } catch {
      return []
    }
  }

  get memoryIdsParsed(): string[] {
    try {
      return JSON.parse(this.memoryIds || '[]')
    } catch {
      return []
    }
  }

  get metadataParsed(): Record<string, unknown> {
    try {
      return JSON.parse(this.metadata || '{}')
    } catch {
      return {}
    }
  }
}
