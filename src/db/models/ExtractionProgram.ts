/**
 * ExtractionProgram Model
 */

import { Model, Query } from '@nozbe/watermelondb'
import { field, text, children } from '@nozbe/watermelondb/decorators'
import type Claim from './Claim'

export default class ExtractionProgram extends Model {
  static table = 'extraction_programs'

  static associations = {
    claims: { type: 'has_many', foreignKey: 'extractionProgramId' },
  } as const

  @text('name') name!: string
  @text('description') description!: string
  @text('type') type!: string // 'pattern' | 'llm'
  @field('version') version!: number
  @field('active') active!: boolean
  @text('patternsJson') patternsJson!: string
  @field('alwaysRun') alwaysRun!: boolean
  @text('promptTemplate') promptTemplate!: string
  @text('outputSchemaJson') outputSchemaJson!: string
  @text('llmTier') llmTier!: string
  @field('llmTemperature') llmTemperature?: number
  @field('llmMaxTokens') llmMaxTokens?: number
  @field('priority') priority!: number
  @field('minConfidence') minConfidence!: number
  @field('isCore') isCore!: boolean
  @text('claimTypesJson') claimTypesJson!: string
  @field('createdAt') createdAt!: number
  @field('updatedAt') updatedAt!: number
  @field('lastUsed') lastUsed?: number
  @field('runCount') runCount!: number
  @field('successRate') successRate!: number
  @field('avgProcessingTimeMs') avgProcessingTimeMs!: number

  @children('claims')
  claims!: Query<Claim>
}
