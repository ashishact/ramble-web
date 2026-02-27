import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class Memory extends Model {
  static table = 'memories'

  @field('content') content!: string
  @field('type') type!: string  // LLM-generated: fact, belief, goal, concern, preference, etc.
  @field('subject') subject?: string  // Who/what this is about
  // Links
  @field('entityIds') entityIds!: string  // JSON array
  @field('topicIds') topicIds!: string  // JSON array
  @field('sourceConversationIds') sourceConversationIds!: string  // JSON array - provenance
  // Scoring
  @field('confidence') confidence!: number  // 0-1
  @field('importance') importance!: number  // 0-1
  // Temporal validity - when is this TRUE
  @field('validFrom') validFrom?: number
  @field('validUntil') validUntil?: number
  // Temporality - when was this EXPRESSED/REINFORCED
  @field('firstExpressed') firstExpressed!: number
  @field('lastReinforced') lastReinforced!: number
  @field('reinforcementCount') reinforcementCount!: number
  // Versioning
  @field('supersededBy') supersededBy?: string
  @field('supersedes') supersedes?: string
  // Metadata
  @field('metadata') metadata!: string  // JSON for emotions, stakes, etc.
  @field('createdAt') createdAt!: number
  // v4: state, origin, activity tracking
  @field('state') state!: string           // 'provisional' | 'stable' | 'contested' | 'superseded' | '' (empty = stable)
  @field('origin') origin?: string         // 'speech' | 'typed' | 'pasted' | 'document' | 'meeting'
  @field('ownershipScore') ownershipScore!: number   // 0-1
  @field('activityScore') activityScore!: number     // 0-1, dynamic, decays over time
  @field('extractionVersion') extractionVersion?: string
  // v5: contradiction edges (belief competition model)
  @field('contradicts') contradicts?: string  // JSON array of memory IDs this belief competes with

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

  get sourceConversationIdsParsed(): string[] {
    try {
      return JSON.parse(this.sourceConversationIds || '[]')
    } catch {
      return []
    }
  }

  get contradictsParsed(): string[] {
    try {
      return JSON.parse(this.contradicts || '[]') as string[]
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

  get isActive(): boolean {
    // Tombstones: explicitly killed via supersede() — exclude
    if (this.supersededBy) return false
    if (this.state === 'superseded') return false
    // Expired temporal memories
    if (this.validUntil && Date.now() > this.validUntil) return false
    // 'contested' memories ARE active — they compete, not die
    return true
  }

  /** True if this memory is in a contradiction cluster */
  get isContested(): boolean {
    return this.contradictsParsed.length > 0
  }
}
