import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export type UploadedFileStatus = 'pending' | 'processing' | 'ready' | 'error'

/**
 * UploadedFile — metadata for files dropped/uploaded into Ramble.
 *
 * Files are stored in a user-selected folder via the File System Access API.
 * This table tracks what was uploaded, where it lives, and its processing status.
 *
 * PHILOSOPHY: Documents get acknowledged and stored. We extract topics
 * (what it's about) but NOT entities — uploaded content could be third-party
 * noise (copied emails, articles, etc.). Entities wait for future deep
 * extraction with user confirmation.
 *
 * ⚠️ NAMING RULE: Never use `updatedAt` as a TS property name.
 *    WatermelonDB auto-touches snake_case `updated_at` on every update().
 *    Use `modifiedAt` as the TS property instead.
 */
export default class UploadedFile extends Model {
  static table = 'uploaded_files'

  /** Original file name (e.g. 'project-plan.pdf') */
  @field('fileName') fileName!: string

  /** MIME type (e.g. 'application/pdf', 'image/png') */
  @field('fileType') fileType!: string

  /** File size in bytes */
  @field('fileSize') fileSize!: number

  /** File extension without dot (e.g. 'pdf', 'png', 'md') */
  @field('fileExtension') fileExtension!: string

  /** Path within the user-selected storage folder */
  @field('storagePath') storagePath!: string

  /** Processing status: 'pending' | 'processing' | 'ready' | 'error' */
  @field('status') status!: UploadedFileStatus

  /** First paragraph or extracted text snippet for quick preview */
  @field('previewText') previewText?: string

  /** Link to recordings table — the recording created for this file */
  @field('recordingId') recordingId?: string

  /** Link to conversations table — assigned after System II processes it */
  @field('conversationId') conversationId?: string

  /** JSON array of tags */
  @field('tags') tags?: string

  /** JSON metadata (dimensions for images, page count for PDFs, etc.) */
  @field('metadata') metadata!: string

  /** Immutable creation timestamp */
  @field('createdAt') createdAt!: number

  /** Last mutation timestamp (named modifiedAt to avoid WatermelonDB auto-touch conflict) */
  @field('updatedAt') modifiedAt!: number

  get tagsParsed(): string[] {
    try {
      return JSON.parse(this.tags || '[]')
    } catch {
      return []
    }
  }

  get metadataParsed(): Record<string, unknown> {
    try {
      return JSON.parse(this.metadata || '{}')
    } catch {
      return {}
    }
  }
}
