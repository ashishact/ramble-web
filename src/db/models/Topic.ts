import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class Topic extends Model {
  static table = 'topics'

  @field('name') name!: string
  @field('description') description?: string
  @field('category') category?: string  // work, personal, health, etc.
  @field('entityIds') entityIds!: string  // JSON array
  // Temporality
  @field('firstMentioned') firstMentioned!: number
  @field('lastMentioned') lastMentioned!: number
  @field('mentionCount') mentionCount!: number
  // Metadata
  @field('metadata') metadata!: string  // JSON
  @field('createdAt') createdAt!: number

  get entityIdsParsed(): string[] {
    try {
      return JSON.parse(this.entityIds || '[]')
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
