/**
 * ExtractionTrace Model
 *
 * Debug/trace information for how propositions, claims, etc. were extracted.
 * Stores LLM prompts/responses, pattern matches, and processing details.
 */

import { Model } from '@nozbe/watermelondb'
import { text, field } from '@nozbe/watermelondb/decorators'

export default class ExtractionTrace extends Model {
  static table = 'extraction_traces'

  // What was traced
  @text('targetType') targetType!: string  // 'proposition' | 'claim' | 'entity' | 'relation'
  @text('targetId') targetId!: string

  // Source info
  @text('conversationId') conversationId!: string
  @text('inputText') inputText!: string

  // Span info (JS pattern matching)
  @text('spanId') spanId!: string | null
  @field('charStart') charStart!: number | null
  @field('charEnd') charEnd!: number | null
  @text('matchedPattern') matchedPattern!: string | null
  @text('matchedText') matchedText!: string | null

  // LLM extraction info
  @text('llmPrompt') llmPrompt!: string | null
  @text('llmResponse') llmResponse!: string | null
  @text('llmModel') llmModel!: string | null
  @field('llmTokensUsed') llmTokensUsed!: number | null

  // Processing info
  @field('processingTimeMs') processingTimeMs!: number
  @text('extractorId') extractorId!: string | null
  @text('error') error!: string | null
  @field('createdAt') createdAt!: number
}
