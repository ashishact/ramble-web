/**
 * LearnedCorrection - Context-aware STT corrections
 *
 * Stores corrections learned from user edits with surrounding context.
 * Context (3 words on each side) enables smarter matching that avoids
 * false positives like "like" → "Lucky" when "like" is actually correct.
 */

import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export default class LearnedCorrection extends Model {
  static table = 'learned_corrections'

  /** The original (wrong) word/phrase from STT */
  @field('original') original!: string

  /** What the user corrected it to */
  @field('corrected') corrected!: string

  /** JSON array of up to 3 words before (e.g., '["I","talked","to"]') */
  @field('leftContext') leftContext!: string

  /** JSON array of up to 3 words after (e.g., '["about","the","project"]') */
  @field('rightContext') rightContext!: string

  /** Number of times this exact correction was made */
  @field('count') count!: number

  /** Calculated confidence score (0-1) */
  @field('confidence') confidence!: number

  @field('createdAt') createdAt!: number

  @field('lastUsedAt') lastUsedAt?: number

  // Parsed getters for convenience
  get leftContextParsed(): string[] {
    try {
      return JSON.parse(this.leftContext) || []
    } catch {
      return []
    }
  }

  get rightContextParsed(): string[] {
    try {
      return JSON.parse(this.rightContext) || []
    } catch {
      return []
    }
  }
}
