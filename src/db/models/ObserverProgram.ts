/**
 * ObserverProgram Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class ObserverProgram extends Model {
  static table = 'observer_programs'

  @text('name') name!: string
  @text('type') type!: string
  @text('description') description!: string

  // Runtime configuration
  @field('active') active!: boolean
  @field('priority') priority!: number

  // Trigger configuration
  @text('triggers') triggers!: string // JSON array of trigger types
  @text('claimTypeFilter') claimTypeFilter!: string | null

  // LLM configuration
  @field('usesLlm') usesLlm!: boolean
  @text('llmTier') llmTier!: string | null
  @field('llmTemperature') llmTemperature!: number | null
  @field('llmMaxTokens') llmMaxTokens!: number | null

  // Prompt and output
  @text('promptTemplate') promptTemplate!: string | null
  @text('outputSchemaJson') outputSchemaJson!: string | null

  // Detection logic
  @text('shouldRunLogic') shouldRunLogic!: string | null
  @text('processLogic') processLogic!: string | null

  // Metadata
  @field('isCore') isCore!: boolean
  @field('version') version!: number
  @field('createdAt') createdAt!: number
  @field('updatedAt') updatedAt!: number

  // Analytics
  @field('runCount') runCount!: number
  @field('successRate') successRate!: number
  @field('avgProcessingTimeMs') avgProcessingTimeMs!: number
}
