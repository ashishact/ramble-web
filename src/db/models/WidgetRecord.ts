import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

/**
 * WidgetRecord — generic storage for LLM-generated widget output.
 *
 * Used by: suggestions, questions, meeting transcription, speak-better, any future widget.
 * Indexed by `type` so queries never cross-contaminate.
 * Full history is preserved — each generation appends a new row (except meeting active state,
 * which is upserted in-place via the store's `upsert` method).
 */
export default class WidgetRecord extends Model {
  static table = 'widget_records'

  /** Widget type discriminator — e.g. 'suggestion' | 'question' | 'meeting' | 'speak_better' */
  @field('type') type!: string

  /** Sub-classification — e.g. 'active' | 'archive' for meetings; empty for others */
  @field('subtype') subtype?: string

  /** Optional link to the sessions table */
  @field('sessionId') sessionId?: string

  /** Human-readable label (auto-generated meeting title, first suggestion text, etc.) */
  @field('title') title?: string

  /** Full JSON payload — type-specific structure */
  @field('content') content!: string

  /** JSON string array for cross-type search / filtering */
  @field('tags') tags?: string

  /** Immutable creation timestamp (set to generatedAt / startedAt of the payload) */
  @field('createdAt') createdAt!: number

  /** Last mutation timestamp */
  @field('updatedAt') updatedAt!: number

  /** Parsed content — returns null on parse failure */
  get contentParsed(): unknown {
    try {
      return JSON.parse(this.content || 'null')
    } catch {
      return null
    }
  }

  /** Parsed tags array — returns [] on parse failure */
  get tagsParsed(): string[] {
    try {
      return JSON.parse(this.tags || '[]')
    } catch {
      return []
    }
  }
}
