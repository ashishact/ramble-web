import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class EntityCooccurrence extends Model {
  static table = 'entity_cooccurrences'

  @field('entityA') entityA!: string      // smaller ID (canonical ordering)
  @field('entityB') entityB!: string      // larger ID
  @field('count') count!: number
  @field('lastSeen') lastSeen!: number
  @field('recentContexts') recentContexts!: string  // JSON array
  @field('createdAt') createdAt!: number

  get recentContextsParsed(): string[] {
    try {
      return JSON.parse(this.recentContexts || '[]')
    } catch {
      return []
    }
  }
}
