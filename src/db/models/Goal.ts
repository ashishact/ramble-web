import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export type GoalStatus = 'active' | 'achieved' | 'abandoned' | 'blocked'

export default class Goal extends Model {
  static table = 'goals'

  @field('statement') statement!: string
  @field('type') type!: string  // LLM-generated
  @field('status') status!: GoalStatus
  @field('progress') progress!: number  // 0-100
  @field('parentGoalId') parentGoalId?: string
  // Links
  @field('entityIds') entityIds!: string  // JSON array
  @field('topicIds') topicIds!: string  // JSON array
  @field('memoryIds') memoryIds!: string  // JSON array - supporting memories
  // Temporality
  @field('firstExpressed') firstExpressed!: number
  @field('lastReferenced') lastReferenced!: number
  @field('achievedAt') achievedAt?: number
  @field('deadline') deadline?: number
  // Metadata
  @field('metadata') metadata!: string  // JSON for motivation, blockers, milestones
  @field('createdAt') createdAt!: number

  get entityIdsParsed(): string[] {
    try {
      return JSON.parse(this.entityIds || '[]')
    } catch {
      return []
    }
  }

  get topicIdsParsed(): string[] {
    try {
      return JSON.parse(this.topicIds || '[]')
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
