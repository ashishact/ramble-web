import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class ExtractionLog extends Model {
  static table = 'extraction_logs'

  @field('pluginId') pluginId!: string
  @field('conversationId') conversationId!: string
  @field('sessionId') sessionId?: string
  // Input/Output
  @field('inputText') inputText!: string
  @field('outputJson') outputJson!: string
  // LLM details (if used)
  @field('llmPrompt') llmPrompt?: string
  @field('llmResponse') llmResponse?: string
  @field('llmModel') llmModel?: string
  @field('tokensUsed') tokensUsed?: number
  // Performance
  @field('processingTimeMs') processingTimeMs!: number
  @field('success') success!: boolean
  @field('error') error?: string
  @field('createdAt') createdAt!: number

  get outputParsed(): Record<string, unknown> {
    try {
      return JSON.parse(this.outputJson || '{}')
    } catch {
      return {}
    }
  }
}
