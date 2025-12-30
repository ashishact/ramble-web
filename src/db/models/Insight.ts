import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class Insight extends Model {
  static table = 'insights'

  @field('content') content!: string
  @field('type') type!: string  // pattern, relationship, synthesis, prediction
  @field('sourceMemoryIds') sourceMemoryIds!: string  // JSON array
  // Temporality
  @field('generatedAt') generatedAt!: number
  @field('revisedAt') revisedAt?: number
  @field('confidence') confidence!: number
  // Metadata
  @field('metadata') metadata!: string  // JSON

  get sourceMemoryIdsParsed(): string[] {
    try {
      return JSON.parse(this.sourceMemoryIds || '[]')
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
