/**
 * EntityMention Model - WatermelonDB
 * Layer 1: Raw text references to entities
 */

import { Model } from '@nozbe/watermelondb'
import { field, date } from '@nozbe/watermelondb/decorators'

export default class EntityMention extends Model {
  static table = 'entity_mentions'

  @field('text') text!: string
  @field('mentionType') mentionType!: string  // pronoun, proper_noun, common_noun, etc.
  @field('suggestedType') suggestedType!: string  // person, organization, project, etc.
  @field('spanId') spanId!: string
  @field('conversationId') conversationId!: string
  @field('resolvedEntityId') resolvedEntityId?: string
  @date('createdAt') createdAt!: number
}
