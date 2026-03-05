import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export type ConversationSource = 'speech' | 'text' | 'typed' | 'pasted' | 'document' | 'meeting'
export type Speaker = 'user' | 'agent'

export interface NormalizedSentence {
  text: string
  speakerHint: 'mic' | 'system' | null
}

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
  // v4: Phase 1 normalization output
  @field('normalizedText') normalizedText?: string   // cleaned full text
  @field('sentences') sentences?: string             // JSON array of NormalizedSentence
  // v8: Recording linkage for intermediate chunk grouping
  @field('recordingId') recordingId?: string          // Links to recording that created this conv
  // v10: Intent classification from normalization
  @field('intent') intent?: string                    // inform | correct | retract | update | instruct | narrate | query | elaborate

  get sentencesParsed(): NormalizedSentence[] {
    try {
      return JSON.parse(this.sentences || '[]') as NormalizedSentence[]
    } catch {
      return []
    }
  }
}
