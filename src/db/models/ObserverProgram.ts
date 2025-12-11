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
  @field('active') active!: boolean
  @text('triggers') triggers!: string // JSON array
  @text('llmTier') llmTier?: string
  @text('promptTemplate') promptTemplate?: string
  @text('outputSchemaJson') outputSchemaJson?: string
  @field('createdAt') createdAt!: number
}
