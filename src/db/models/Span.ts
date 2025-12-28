/**
 * Span Model - Layer 1: Text regions in conversations
 *
 * Computed in JS via pattern matching (not LLM).
 * Marks text regions before any propositions/claims exist.
 *
 * Flow: Conversation → Span → Proposition → Stance → Claim(derived)
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Span extends Model {
  static table = 'spans'

  @text('conversationId') conversationId!: string
  @field('charStart') charStart!: number
  @field('charEnd') charEnd!: number
  @text('textExcerpt') textExcerpt!: string
  @text('matchedBy') matchedBy!: string    // 'pattern' | 'rule'
  @text('patternId') patternId!: string | null
  @field('createdAt') createdAt!: number
}
