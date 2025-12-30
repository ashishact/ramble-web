import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class Session extends Model {
  static table = 'sessions'

  @field('startedAt') startedAt!: number
  @field('endedAt') endedAt?: number
  @field('unitCount') unitCount!: number
  @field('summary') summary?: string
  @field('metadata') metadata!: string  // JSON

  get metadataParsed(): Record<string, unknown> {
    try {
      return JSON.parse(this.metadata || '{}')
    } catch {
      return {}
    }
  }
}
