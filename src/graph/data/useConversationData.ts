/**
 * useConversationData — Reactive Conversation Query Hook
 *
 * Like useGraphData but for the conversations table (different schema from nodes).
 * Auto-updates when conversations change.
 *
 * Usage:
 *   const { data, loading } = useConversationData({
 *     limit: 50,
 *     orderBy: { field: 'timestamp', dir: 'desc' },
 *   })
 *
 *   // data[0].rawText, data[0].speaker, data[0].sessionId
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { graphEventBus } from '../events'
import { getGraphService } from '../index'
import type { ConversationDataOptions, ConversationRecord } from './types'

function buildConversationQuery(options?: ConversationDataOptions): string {
  const parts: string[] = ['SELECT * FROM conversations']

  // WHERE clauses
  const wheres: string[] = []
  if (options?.where) {
    for (const [key, value] of Object.entries(options.where)) {
      if (value === null) {
        wheres.push(`${key} IS NULL`)
      } else if (typeof value === 'string') {
        wheres.push(`${key} = '${value}'`)
      } else if (typeof value === 'number') {
        wheres.push(`${key} = ${value}`)
      } else if (typeof value === 'boolean') {
        wheres.push(`${key} = ${value}`)
      }
    }
  }

  if (wheres.length > 0) {
    parts.push('WHERE ' + wheres.join(' AND '))
  }

  // ORDER BY
  if (options?.orderBy) {
    const dir = options.orderBy.dir?.toUpperCase() ?? 'DESC'
    parts.push(`ORDER BY ${options.orderBy.field} ${dir}`)
  } else {
    parts.push('ORDER BY timestamp DESC')
  }

  // LIMIT
  parts.push(`LIMIT ${options?.limit ?? 100}`)

  return parts.join(' ')
}

function parseConversationRow(row: Record<string, unknown>): ConversationRecord {
  let attachments: ConversationRecord['attachments'] = []
  try { attachments = JSON.parse((row.attachments as string) || '[]') } catch { /* ignore */ }
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    timestamp: row.timestamp as number,
    rawText: row.raw_text as string,
    source: row.source as string,
    speaker: row.speaker as string,
    processed: row.processed as boolean,
    intent: (row.intent as string) ?? null,
    recordingId: (row.recording_id as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    attachments,
    createdAt: row.created_at as number,
  }
}

export function useConversationData(
  options?: ConversationDataOptions
): { data: ConversationRecord[]; loading: boolean; error: Error | null } {
  const [data, setData] = useState<ConversationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const sql = useMemo(() => buildConversationQuery(options), [
    options?.limit,
    options?.orderBy?.field,
    options?.orderBy?.dir,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(options?.where),
  ])

  const runQuery = useCallback(async () => {
    try {
      const graph = await getGraphService()
      const rows = await graph.query<Record<string, unknown>>(sql)
      if (mountedRef.current) {
        setData(rows.map(parseConversationRow))
        setLoading(false)
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, ...(options?.deps ?? [])])

  // Initial query
  useEffect(() => {
    setLoading(true)
    runQuery()
  }, [runQuery])

  // Re-run on conversation changes
  useEffect(() => {
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.includes('conversations')) {
        runQuery()
      }
    })
    return unsub
  }, [runQuery])

  return { data, loading, error }
}
