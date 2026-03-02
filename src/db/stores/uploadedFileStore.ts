import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import UploadedFile from '../models/UploadedFile'
import type { UploadedFileStatus } from '../models/UploadedFile'

const files = database.get<UploadedFile>('uploaded_files')

/**
 * Uploaded File Store — CRUD for file upload metadata.
 *
 * Files are stored in a user-selected folder via File System Access API.
 * This store manages the metadata: what was uploaded, where it lives,
 * processing status, and links to recordings/conversations.
 */
export const uploadedFileStore = {
  /**
   * Create a new uploaded file record.
   * Called when a file is dropped/uploaded into Ramble.
   */
  async create(data: {
    fileName: string
    fileType: string
    fileSize: number
    fileExtension: string
    storagePath: string
    status?: UploadedFileStatus
    previewText?: string
    recordingId?: string
    conversationId?: string
    tags?: string[]
    metadata?: Record<string, unknown>
  }): Promise<UploadedFile> {
    const now = Date.now()
    return await database.write(async () => {
      return await files.create((r) => {
        r.fileName = data.fileName
        r.fileType = data.fileType
        r.fileSize = data.fileSize
        r.fileExtension = data.fileExtension
        r.storagePath = data.storagePath
        r.status = data.status ?? 'pending'
        r.previewText = data.previewText
        r.recordingId = data.recordingId
        r.conversationId = data.conversationId
        r.tags = data.tags ? JSON.stringify(data.tags) : undefined
        r.metadata = JSON.stringify(data.metadata ?? {})
        r.createdAt = now
        r.modifiedAt = now
      })
    })
  },

  async getById(id: string): Promise<UploadedFile | null> {
    try {
      return await files.find(id)
    } catch {
      return null
    }
  },

  /**
   * Get all files linked to a specific recording.
   */
  async getByRecording(recordingId: string): Promise<UploadedFile[]> {
    return await files.query(
      Q.where('recordingId', recordingId),
      Q.sortBy('createdAt', Q.desc),
    ).fetch()
  },

  /**
   * Get the N most recent uploads, sorted by createdAt DESC.
   */
  async getRecent(limit = 20): Promise<UploadedFile[]> {
    return await files.query(
      Q.sortBy('createdAt', Q.desc),
      Q.take(limit),
    ).fetch()
  },

  /**
   * Get files by MIME type prefix (e.g. 'image/' for all images).
   */
  async getByType(typePrefix: string, limit = 20): Promise<UploadedFile[]> {
    // WatermelonDB doesn't support LIKE, so we fetch recent and filter
    const all = await files.query(
      Q.sortBy('createdAt', Q.desc),
      Q.take(limit * 3), // Over-fetch to account for filtering
    ).fetch()
    return all
      .filter(f => f.fileType.startsWith(typePrefix))
      .slice(0, limit)
  },

  /**
   * Get files by processing status.
   */
  async getByStatus(status: UploadedFileStatus, limit = 50): Promise<UploadedFile[]> {
    return await files.query(
      Q.where('status', status),
      Q.sortBy('createdAt', Q.desc),
      Q.take(limit),
    ).fetch()
  },

  /**
   * Update file status (e.g. pending → processing → ready/error).
   */
  async updateStatus(id: string, status: UploadedFileStatus): Promise<void> {
    const record = await files.find(id)
    await database.write(async () => {
      await record.update((r) => {
        r.status = status
        r.modifiedAt = Date.now()
      })
    })
  },

  /**
   * Link an uploaded file to a conversation (after System II processes it).
   */
  async linkConversation(id: string, conversationId: string): Promise<void> {
    const record = await files.find(id)
    await database.write(async () => {
      await record.update((r) => {
        r.conversationId = conversationId
        r.modifiedAt = Date.now()
      })
    })
  },

  /**
   * Update metadata (e.g. add image dimensions after processing).
   */
  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const record = await files.find(id)
    await database.write(async () => {
      await record.update((r) => {
        r.metadata = JSON.stringify(metadata)
        r.modifiedAt = Date.now()
      })
    })
  },
}
