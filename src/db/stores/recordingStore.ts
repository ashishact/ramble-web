import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Recording from '../models/Recording'
import type { RecordingType, ProcessingMode } from '../../program/types/recording'

const recordings = database.get<Recording>('recordings')

/**
 * Recording Store — CRUD for recording sessions.
 *
 * Every input (voice, text, paste, document, image) creates a recording.
 * Recordings are the backbone of time travel — the user can scrub through
 * the timeline and see what was being processed at any point.
 */
export const recordingStore = {
  /**
   * Create a new recording record.
   * Called when RecordingManager.end() completes a recording session.
   */
  async create(data: {
    id?: string
    type: RecordingType
    startedAt: number
    endedAt?: number
    fullText: string
    source: 'in-app' | 'out-of-app'
    audioType?: 'mic' | 'system'
    throughputRate?: number
    chunkCount: number
    processingMode?: ProcessingMode
    sessionId?: string
    metadata?: Record<string, unknown>
  }): Promise<Recording> {
    const now = Date.now()
    return await database.write(async () => {
      return await recordings.create((r) => {
        if (data.id) r._raw.id = data.id
        r.type = data.type
        r.startedAt = data.startedAt
        r.endedAt = data.endedAt
        r.fullText = data.fullText
        r.source = data.source
        r.audioType = data.audioType
        r.throughputRate = data.throughputRate
        r.chunkCount = data.chunkCount
        r.processingMode = data.processingMode
        r.sessionId = data.sessionId
        r.metadata = JSON.stringify(data.metadata ?? {})
        r.createdAt = now
      })
    })
  },

  async getById(id: string): Promise<Recording | null> {
    try {
      return await recordings.find(id)
    } catch {
      return null
    }
  },

  /**
   * Get recordings for a specific session, sorted by startedAt DESC.
   */
  async getBySession(sessionId: string, limit = 50): Promise<Recording[]> {
    return await recordings.query(
      Q.where('sessionId', sessionId),
      Q.sortBy('startedAt', Q.desc),
      Q.take(limit),
    ).fetch()
  },

  /**
   * Get the N most recent recordings, sorted by createdAt DESC.
   */
  async getRecent(limit = 20): Promise<Recording[]> {
    return await recordings.query(
      Q.sortBy('createdAt', Q.desc),
      Q.take(limit),
    ).fetch()
  },

  /**
   * Get recordings within a time range (for time travel scrubbing).
   */
  async getRange(fromTs: number, toTs: number): Promise<Recording[]> {
    return await recordings.query(
      Q.where('startedAt', Q.gte(fromTs)),
      Q.where('startedAt', Q.lte(toTs)),
      Q.sortBy('startedAt', Q.asc),
    ).fetch()
  },

  /**
   * Get recordings by type (e.g. all voice recordings, all document uploads).
   */
  async getByType(type: RecordingType, limit = 20): Promise<Recording[]> {
    return await recordings.query(
      Q.where('type', type),
      Q.sortBy('createdAt', Q.desc),
      Q.take(limit),
    ).fetch()
  },

  /**
   * Update a recording's processing mode after it's been assigned.
   */
  async updateProcessingMode(id: string, mode: ProcessingMode): Promise<void> {
    const record = await recordings.find(id)
    await database.write(async () => {
      await record.update((r) => {
        r.processingMode = mode
      })
    })
  },
}
