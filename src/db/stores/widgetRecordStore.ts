import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import WidgetRecord from '../models/WidgetRecord'

const records = database.get<WidgetRecord>('widget_records')

export const widgetRecordStore = {
  /**
   * Append a new record (for suggestion, question, speak_better).
   * Creates a fresh row each call — full history is preserved.
   */
  async create(data: {
    type: string
    subtype?: string
    sessionId?: string
    title?: string
    content: unknown
    tags?: string[]
    createdAt?: number
  }): Promise<WidgetRecord> {
    const now = Date.now()
    return await database.write(async () => {
      return await records.create((r) => {
        r.type = data.type
        r.subtype = data.subtype
        r.sessionId = data.sessionId
        r.title = data.title
        r.content = JSON.stringify(data.content)
        r.tags = data.tags ? JSON.stringify(data.tags) : undefined
        r.createdAt = data.createdAt ?? now
        r.modifiedAt = now
      })
    })
  },

  /**
   * Update an existing record's content and/or metadata.
   * Used for patching the meeting active state and title patches.
   */
  async update(id: string, data: {
    content?: unknown
    title?: string
    subtype?: string
    tags?: string[]
  }): Promise<void> {
    const record = await records.find(id)
    await database.write(async () => {
      await record.update((r) => {
        if (data.content !== undefined) r.content = JSON.stringify(data.content)
        if (data.title !== undefined) r.title = data.title
        if (data.subtype !== undefined) r.subtype = data.subtype
        if (data.tags !== undefined) r.tags = JSON.stringify(data.tags)
        r.modifiedAt = Date.now()
      })
    })
  },

  /**
   * Get the single latest record for a (type, optional subtype), sorted by createdAt DESC.
   * Returns null if no match.
   */
  async getLatest(type: string, subtype?: string): Promise<WidgetRecord | null> {
    const clauses = [
      Q.where('type', type),
      ...(subtype !== undefined ? [Q.where('subtype', subtype)] : []),
      Q.sortBy('createdAt', Q.desc),
      Q.take(1),
    ]
    const results = await records.query(...clauses).fetch()
    return results[0] ?? null
  },

  /**
   * Get the N most recent records for a (type, optional subtype), sorted by createdAt DESC.
   */
  async getRecent(type: string, limit: number, subtype?: string): Promise<WidgetRecord[]> {
    const clauses = [
      Q.where('type', type),
      ...(subtype !== undefined ? [Q.where('subtype', subtype)] : []),
      Q.sortBy('createdAt', Q.desc),
      Q.take(limit),
    ]
    return await records.query(...clauses).fetch()
  },

  /**
   * Time range query — for history / time-travel.
   * Returns records within [fromTs, toTs] inclusive, sorted by createdAt DESC.
   */
  async getRange(
    type: string,
    fromTs: number,
    toTs: number,
    subtype?: string
  ): Promise<WidgetRecord[]> {
    const clauses = [
      Q.where('type', type),
      ...(subtype !== undefined ? [Q.where('subtype', subtype)] : []),
      Q.where('createdAt', Q.gte(fromTs)),
      Q.where('createdAt', Q.lte(toTs)),
      Q.sortBy('createdAt', Q.desc),
    ]
    return await records.query(...clauses).fetch()
  },

  /**
   * Get all records for a session, optionally filtered by type.
   */
  async getBySession(sessionId: string, type?: string): Promise<WidgetRecord[]> {
    const clauses = [
      Q.where('sessionId', sessionId),
      ...(type !== undefined ? [Q.where('type', type)] : []),
      Q.sortBy('createdAt', Q.desc),
    ]
    return await records.query(...clauses).fetch()
  },

  /**
   * Upsert: update if a (type, subtype) row already exists, create if not.
   * Used exclusively for the meeting active state — there is at most one active meeting at a time.
   */
  async upsert(
    type: string,
    subtype: string,
    data: {
      content: unknown
      title?: string
      sessionId?: string
      tags?: string[]
    }
  ): Promise<WidgetRecord> {
    const existing = await this.getLatest(type, subtype)
    if (existing) {
      await this.update(existing.id, {
        content: data.content,
        title: data.title,
        tags: data.tags,
      })
      return existing
    }
    return this.create({ type, subtype, ...data })
  },

  async getById(id: string): Promise<WidgetRecord | null> {
    try {
      return await records.find(id)
    } catch {
      return null
    }
  },

  async delete(id: string): Promise<boolean> {
    try {
      const record = await records.find(id)
      await database.write(async () => {
        await record.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },
}
