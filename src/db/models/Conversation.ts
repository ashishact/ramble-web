/**
 * Conversation Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Conversation extends Model {
  static table = 'conversations'

  @text('sessionId') sessionId!: string
  @field('timestamp') timestamp!: number
  @text('rawText') rawText!: string
  @text('sanitizedText') sanitizedText!: string
  @text('source') source!: string // 'speech' | 'text'
  @text('precedingContextSummary') precedingContextSummary!: string
  @field('createdAt') createdAt!: number
  @field('processed') processed!: boolean
}
