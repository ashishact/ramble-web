import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export type ConversationSource = 'speech' | 'text'
export type Speaker = 'user' | 'agent'

export default class Conversation extends Model {
  static table = 'conversations'

  @field('sessionId') sessionId!: string
  @field('timestamp') timestamp!: number
  @field('rawText') rawText!: string
  @field('sanitizedText') sanitizedText!: string
  @field('summary') summary?: string  // LLM-generated summary for large texts
  @field('source') source!: ConversationSource
  @field('speaker') speaker!: Speaker
  @field('processed') processed!: boolean
  @field('createdAt') createdAt!: number
}
