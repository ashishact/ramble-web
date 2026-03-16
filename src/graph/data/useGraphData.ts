/**
 * useGraphData — Universal Reactive Node Query Hook
 *
 * The single hook every widget uses to read graph data.
 * Takes a label (entity, topic, memory, goal, etc.) and optional filters,
 * returns parsed, flattened records that auto-update on changes.
 *
 * Usage:
 *   const { data, loading } = useGraphData<EntityItem>('entity', {
 *     limit: 50,
 *     orderBy: { field: 'lastMentioned', dir: 'desc' },
 *   })
 *
 *   // data[0].name, data[0].type — properties are flattened
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { graphEventBus } from '../events'
import { getGraphService } from '../index'
import type { GraphDataOptions, BaseNodeRecord } from './types'

/**
 * Build SQL query from label + options.
 *
 * Every query follows the same pattern:
 *   SELECT * FROM nodes WHERE list_contains(labels, $label) [AND filters] [ORDER BY] [LIMIT]
 */
function buildQuery(label: string, options?: GraphDataOptions): string {
  const parts: string[] = [
    `SELECT * FROM nodes WHERE list_contains(labels, '${label}')`,
  ]

  // WHERE clause from simple property filters
  if (options?.where) {
    for (const [key, value] of Object.entries(options.where)) {
      if (typeof value === 'string') {
        parts.push(`AND json_extract_string(properties, '$.${key}') = '${value}'`)
      } else if (typeof value === 'number') {
        parts.push(`AND CAST(json_extract(properties, '$.${key}') AS DOUBLE) = ${value}`)
      } else if (typeof value === 'boolean') {
        parts.push(`AND json_extract(properties, '$.${key}') = ${value}`)
      }
    }
  }

  // ORDER BY — default to updated_at DESC
  if (options?.orderBy) {
    const dir = options.orderBy.dir?.toUpperCase() ?? 'DESC'
    // Check if field is a built-in column or a property
    if (['created_at', 'updated_at', 'id'].includes(options.orderBy.field)) {
      parts.push(`ORDER BY ${options.orderBy.field} ${dir}`)
    } else {
      parts.push(`ORDER BY json_extract(properties, '$.${options.orderBy.field}') ${dir}`)
    }
  } else {
    parts.push('ORDER BY updated_at DESC')
  }

  // LIMIT
  parts.push(`LIMIT ${options?.limit ?? 100}`)

  return parts.join(' ')
}

/**
 * Parse a raw DuckDB node row into a flat T object.
 * Spreads JSON properties into the top level.
 */
function parseRow<T extends BaseNodeRecord>(row: Record<string, unknown>): T {
  const props = row.properties ?? {}

  return {
    id: row.id as string,
    labels: row.labels as string[],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    ...props,
  } as T
}

export function useGraphData<T extends BaseNodeRecord = BaseNodeRecord>(
  label: string,
  options?: GraphDataOptions
): { data: T[]; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Memoize SQL to prevent unnecessary re-queries
  const sql = useMemo(() => buildQuery(label, options), [
    label,
    options?.limit,
    options?.orderBy?.field,
    options?.orderBy?.dir,
    // Serialize where for stable comparison
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(options?.where),
  ])

  const runQuery = useCallback(async () => {
    try {
      const graph = await getGraphService()
      const rows = await graph.query<Record<string, unknown>>(sql)
      if (mountedRef.current) {
        setData(rows.map(r => parseRow<T>(r)))
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

  // Re-run on table changes
  useEffect(() => {
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.includes('nodes')) {
        runQuery()
      }
    })
    return unsub
  }, [runQuery])

  return { data, loading, error }
}
