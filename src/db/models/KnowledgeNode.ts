import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export type NodeType = 'text' | 'keyvalue' | 'table' | 'reference' | 'group'
export type NodeSource = 'user' | 'document' | 'meeting_other' | 'inferred'
export type NodeVerification = 'unverified' | 'mentioned' | 'confirmed' | 'contradicted'

export default class KnowledgeNode extends Model {
  static table = 'knowledge_nodes'

  @field('entityId') entityId!: string
  @field('parentId') parentId!: string | null
  @field('depth') depth!: number
  @field('sortOrder') sortOrder!: number
  @field('label') label!: string
  @field('summary') summary!: string | null
  @field('content') content!: string | null
  @field('nodeType') nodeType!: NodeType
  @field('source') source!: NodeSource
  @field('verification') verification!: NodeVerification
  @field('memoryIds') memoryIds!: string       // JSON array
  @field('templateKey') templateKey!: string | null
  @field('childCount') childCount!: number
  @field('metadata') metadata!: string          // JSON
  @field('createdAt') createdAt!: number
  @field('modifiedAt') modifiedAt!: number

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

  get isDeleted(): boolean {
    return !!this.metadataParsed.deleted
  }
}
