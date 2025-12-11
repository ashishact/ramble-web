/**
 * Extension Model
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Extension extends Model {
  static table = 'extensions'

  @text('extensionType') extensionType!: string
  @text('name') name!: string
  @text('description') description!: string
  @text('configJson') configJson!: string
  @text('systemPrompt') systemPrompt?: string
  @text('userPromptTemplate') userPromptTemplate?: string
  @text('llmTier') llmTier?: string
  @text('status') status!: string
  @field('createdAt') createdAt!: number
  @field('lastUsed') lastUsed?: number
}
