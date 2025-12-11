/**
 * SourceTracking Model
 */

import { Model, Relation } from '@nozbe/watermelondb'
import { field, text, relation } from '@nozbe/watermelondb/decorators'
import type Claim from './Claim'

export default class SourceTracking extends Model {
  static table = 'source_tracking'

  static associations = {
    claims: { type: 'belongs_to', key: 'claimId' },
  } as const

  @text('claimId') claimId!: string
  @text('unitId') unitId!: string
  @text('unitText') unitText!: string
  @text('textExcerpt') textExcerpt!: string
  @field('charStart') charStart!: number | null
  @field('charEnd') charEnd!: number | null
  @text('patternId') patternId!: string | null
  @text('llmPrompt') llmPrompt!: string
  @text('llmResponse') llmResponse!: string
  @field('createdAt') createdAt!: number

  @relation('claims', 'claimId')
  claim!: Relation<Claim>
}
