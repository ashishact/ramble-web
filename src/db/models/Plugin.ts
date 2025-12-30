import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export type PluginType = 'extractor' | 'observer' | 'validator'

export interface PluginTriggers {
  patterns?: string[]  // Regex patterns
  conditions?: Record<string, unknown>  // Custom conditions
}

export interface PluginLLMConfig {
  temperature?: number
  maxTokens?: number
  model?: string
}

export default class Plugin extends Model {
  static table = 'plugins'

  @field('name') name!: string
  @field('description') description!: string
  @field('type') type!: PluginType
  @field('version') version!: number
  @field('active') active!: boolean
  // Trigger conditions
  @field('triggers') triggers!: string  // JSON
  @field('alwaysRun') alwaysRun!: boolean
  // LLM configuration
  @field('promptTemplate') promptTemplate?: string
  @field('systemPrompt') systemPrompt?: string
  @field('outputSchema') outputSchema?: string  // JSON schema
  @field('llmTier') llmTier?: string  // cheap, balanced, quality
  @field('llmConfig') llmConfig?: string  // JSON
  // Stats
  @field('runCount') runCount!: number
  @field('successCount') successCount!: number
  @field('avgProcessingTimeMs') avgProcessingTimeMs!: number
  // Meta
  @field('isCore') isCore!: boolean
  @field('createdAt') createdAt!: number
  @field('updatedAt') updatedAt!: number
  @field('lastUsed') lastUsed?: number

  get triggersParsed(): PluginTriggers {
    try {
      return JSON.parse(this.triggers || '{}')
    } catch {
      return {}
    }
  }

  get outputSchemaParsed(): Record<string, unknown> | null {
    if (!this.outputSchema) return null
    try {
      return JSON.parse(this.outputSchema)
    } catch {
      return null
    }
  }

  get llmConfigParsed(): PluginLLMConfig {
    try {
      return JSON.parse(this.llmConfig || '{}')
    } catch {
      return {}
    }
  }

  get successRate(): number {
    if (this.runCount === 0) return 0
    return this.successCount / this.runCount
  }
}
