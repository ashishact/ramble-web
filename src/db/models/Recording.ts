import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

/**
 * Recording — persisted recording session for time travel.
 *
 * Every input (voice, text, paste, document, image) creates a Recording.
 * System I saves intermediate results as they arrive (for timeline scrubbing).
 * System II saves the final result (for durable processing).
 *
 * ⚠️ NAMING RULE: Never use `updatedAt` as a TS property name.
 *    WatermelonDB auto-touches snake_case `updated_at` on every update().
 *    Use `modifiedAt` as the TS property instead.
 */
export default class Recording extends Model {
  static table = 'recordings'

  /** How the content arrived: 'voice' | 'text' | 'paste' | 'document' | 'image' */
  @field('type') type!: string

  /** When the recording session began (Unix ms) */
  @field('startedAt') startedAt!: number

  /** When the recording session ended (Unix ms). Null while active. */
  @field('endedAt') endedAt?: number

  /** Complete accumulated text */
  @field('fullText') fullText!: string

  /** Where this originated: 'in-app' | 'out-of-app' */
  @field('source') source!: string

  /** For voice recordings: 'mic' | 'system' */
  @field('audioType') audioType?: string

  /**
   * Characters per second — physical bottleneck signal.
   * Speech ~2.5, typing ~5-10, paste/document capped at 1000.
   */
  @field('throughputRate') throughputRate?: number

  /** Number of intermediate chunks received */
  @field('chunkCount') chunkCount!: number

  /** Processing mode: 'system-i' | 'system-ii' */
  @field('processingMode') processingMode?: string

  /** Optional link to sessions table */
  @field('sessionId') sessionId?: string

  /** JSON for extensibility */
  @field('metadata') metadata!: string

  /** Immutable creation timestamp */
  @field('createdAt') createdAt!: number

  get metadataParsed(): Record<string, unknown> {
    try {
      return JSON.parse(this.metadata || '{}')
    } catch {
      return {}
    }
  }
}
