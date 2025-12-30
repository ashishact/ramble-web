/**
 * Vocabulary Model
 *
 * Custom vocabulary for STT entity spelling correction.
 * Stores phonetic codes (Double Metaphone) for fuzzy matching.
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Vocabulary extends Model {
  static table = 'vocabulary'

  @text('correctSpelling') correctSpelling!: string
  @text('entityType') entityType!: string
  @text('contextHints') contextHints!: string  // JSON array
  @text('phoneticPrimary') phoneticPrimary!: string
  @text('phoneticSecondary') phoneticSecondary!: string | null
  @field('usageCount') usageCount!: number
  @text('variantCountsJson') variantCountsJson!: string  // JSON object
  @field('createdAt') createdAt!: number
  @field('lastUsed') lastUsed!: number | null
  @text('sourceEntityId') sourceEntityId!: string | null
}
