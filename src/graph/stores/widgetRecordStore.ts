/**
 * WidgetRecordStore — DuckDB-backed widget record storage
 *
 * On-demand widget output persistence.
 * Used by: suggestions, questions, meeting transcription, speak-better.
 *
 * Records are stored as graph nodes with label 'widget_record'.
 */

import { graphMutations } from '../data'

// ============================================================================
// Types
// ============================================================================

export interface WidgetRecordItem {
  id: string
  type: string
  subtype?: string
  sessionId?: string
  title?: string
  content: string
  tags?: string[]
  createdAt: number
  modifiedAt: number
  contentParsed: unknown
}

// ============================================================================
// Row parser
// ============================================================================

function parseRow(row: Record<string, unknown>): WidgetRecordItem {
  const props = typeof row.properties === 'string'
    ? JSON.parse(row.properties as string)
    : (row.properties ?? {}) as Record<string, unknown>

  let contentParsed: unknown = null
  try {
    contentParsed = JSON.parse((props.content as string) || 'null')
  } catch { /* ignore */ }

  let tags: string[] | undefined
  if (props.tags) {
    tags = Array.isArray(props.tags)
      ? props.tags as string[]
      : undefined
  }

  return {
    id: row.id as string,
    type: props.type as string,
    subtype: props.subtype as string | undefined,
    sessionId: props.sessionId as string | undefined,
    title: props.title as string | undefined,
    content: (props.content as string) ?? '',
    tags,
    createdAt: (props.createdAt as number) ?? (row.created_at as number),
    modifiedAt: (props.modifiedAt as number) ?? (row.updated_at as number),
    contentParsed,
  }
}

// ============================================================================
// Store
// ============================================================================

export const widgetRecordStore = {
  /**
   * Append a new record. Creates a fresh row — full history is preserved.
   */
  async create(data: {
    type: string
    subtype?: string
    sessionId?: string
    title?: string
    content: unknown
    tags?: string[]
    createdAt?: number
  }): Promise<WidgetRecordItem> {
    const now = Date.now()
    const contentStr = JSON.stringify(data.content)

    const node = await graphMutations.createNode(['widget_record'], {
      type: data.type,
      subtype: data.subtype,
      sessionId: data.sessionId,
      title: data.title,
      content: contentStr,
      tags: data.tags,
      createdAt: data.createdAt ?? now,
      modifiedAt: now,
    })

    return {
      id: node.id,
      type: data.type,
      subtype: data.subtype,
      sessionId: data.sessionId,
      title: data.title,
      content: contentStr,
      tags: data.tags,
      createdAt: data.createdAt ?? now,
      modifiedAt: now,
      contentParsed: data.content,
    }
  },

  /**
   * Update an existing record's content and/or metadata.
   */
  async update(id: string, data: {
    content?: unknown
    title?: string
    subtype?: string
    tags?: string[]
  }): Promise<void> {
    const updates: Record<string, unknown> = { modifiedAt: Date.now() }
    if (data.content !== undefined) updates.content = JSON.stringify(data.content)
    if (data.title !== undefined) updates.title = data.title
    if (data.subtype !== undefined) updates.subtype = data.subtype
    if (data.tags !== undefined) updates.tags = data.tags
    await graphMutations.updateNodeProperties(id, updates)
  },

  /**
   * Get the single latest record for a (type, optional subtype).
   */
  async getLatest(type: string, subtype?: string): Promise<WidgetRecordItem | null> {
    let sql = `SELECT * FROM nodes WHERE list_contains(labels, 'widget_record')
      AND json_extract_string(properties, '$.type') = $1`
    const params: unknown[] = [type]

    if (subtype !== undefined) {
      sql += ` AND json_extract_string(properties, '$.subtype') = $2`
      params.push(subtype)
    }

    sql += ` ORDER BY CAST(json_extract(properties, '$.createdAt') AS BIGINT) DESC LIMIT 1`

    const rows = await graphMutations.query<Record<string, unknown>>(sql, params)
    return rows.length > 0 ? parseRow(rows[0]) : null
  },

  /**
   * Get the N most recent records for a (type, optional subtype).
   */
  async getRecent(type: string, limit: number, subtype?: string): Promise<WidgetRecordItem[]> {
    let sql = `SELECT * FROM nodes WHERE list_contains(labels, 'widget_record')
      AND json_extract_string(properties, '$.type') = $1`
    const params: unknown[] = [type]

    if (subtype !== undefined) {
      sql += ` AND json_extract_string(properties, '$.subtype') = $2`
      params.push(subtype)
    }

    sql += ` ORDER BY CAST(json_extract(properties, '$.createdAt') AS BIGINT) DESC LIMIT ${limit}`

    const rows = await graphMutations.query<Record<string, unknown>>(sql, params)
    return rows.map(parseRow)
  },

  /**
   * Time range query for history / time-travel.
   */
  async getRange(
    type: string,
    fromTs: number,
    toTs: number,
    subtype?: string
  ): Promise<WidgetRecordItem[]> {
    let sql = `SELECT * FROM nodes WHERE list_contains(labels, 'widget_record')
      AND json_extract_string(properties, '$.type') = $1
      AND CAST(json_extract(properties, '$.createdAt') AS BIGINT) >= $2
      AND CAST(json_extract(properties, '$.createdAt') AS BIGINT) <= $3`
    const params: unknown[] = [type, fromTs, toTs]

    if (subtype !== undefined) {
      sql += ` AND json_extract_string(properties, '$.subtype') = $4`
      params.push(subtype)
    }

    sql += ` ORDER BY CAST(json_extract(properties, '$.createdAt') AS BIGINT) DESC`

    const rows = await graphMutations.query<Record<string, unknown>>(sql, params)
    return rows.map(parseRow)
  },

  /**
   * Get all records for a session, optionally filtered by type.
   */
  async getBySession(sessionId: string, type?: string): Promise<WidgetRecordItem[]> {
    let sql = `SELECT * FROM nodes WHERE list_contains(labels, 'widget_record')
      AND json_extract_string(properties, '$.sessionId') = $1`
    const params: unknown[] = [sessionId]

    if (type !== undefined) {
      sql += ` AND json_extract_string(properties, '$.type') = $2`
      params.push(type)
    }

    sql += ` ORDER BY CAST(json_extract(properties, '$.createdAt') AS BIGINT) DESC`

    const rows = await graphMutations.query<Record<string, unknown>>(sql, params)
    return rows.map(parseRow)
  },

  /**
   * Upsert: update if a (type, subtype) row already exists, create if not.
   * Used for meeting active state — at most one active meeting at a time.
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
  ): Promise<WidgetRecordItem> {
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

  async getById(id: string): Promise<WidgetRecordItem | null> {
    const rows = await graphMutations.query<Record<string, unknown>>(
      `SELECT * FROM nodes WHERE id = $1 AND list_contains(labels, 'widget_record')`,
      [id]
    )
    return rows.length > 0 ? parseRow(rows[0]) : null
  },

  async delete(id: string): Promise<boolean> {
    try {
      await graphMutations.deleteNode(id)
      return true
    } catch {
      return false
    }
  },
}
