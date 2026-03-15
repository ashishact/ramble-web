/**
 * useGraphCounts — Reactive Label Counts
 *
 * Returns counts for one or more node labels, auto-updates on changes.
 * Designed for StatsWidget and anywhere you need "N entities, M topics" etc.
 *
 * Usage:
 *   const { counts, loading } = useGraphCounts(['entity', 'topic', 'memory', 'goal'])
 *   // counts.entity === 42, counts.topic === 17, ...
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { graphEventBus } from '../events'
import { getGraphService } from '../index'

export function useGraphCounts(
  labels: string[]
): { counts: Record<string, number>; loading: boolean; error: Error | null } {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Stable key for memoization
  const labelsKey = useMemo(() => labels.slice().sort().join(','), [labels])

  const runQuery = useCallback(async () => {
    try {
      const graph = await getGraphService()

      // Build a single SQL that counts each label in one pass
      // UNION ALL is efficient — one round-trip to the worker
      const unions = labels.map(
        label => `SELECT '${label}' AS label, COUNT(*) AS cnt FROM nodes WHERE list_contains(labels, '${label}')`
      )
      const sql = unions.join(' UNION ALL ')

      const rows = await graph.query<{ label: string; cnt: number }>(sql)

      if (mountedRef.current) {
        const result: Record<string, number> = {}
        for (const label of labels) {
          result[label] = 0
        }
        for (const row of rows) {
          result[row.label] = Number(row.cnt)
        }
        setCounts(result)
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
  }, [labelsKey])

  // Initial query
  useEffect(() => {
    setLoading(true)
    runQuery()
  }, [runQuery])

  // Re-run on node changes
  useEffect(() => {
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.includes('nodes')) {
        runQuery()
      }
    })
    return unsub
  }, [runQuery])

  return { counts, loading, error }
}

/**
 * useConversationCount — Reactive count for conversations table
 */
export function useConversationCount(): { count: number; loading: boolean } {
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const runQuery = useCallback(async () => {
    try {
      const graph = await getGraphService()
      const rows = await graph.query<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM conversations'
      )
      if (mountedRef.current) {
        setCount(Number(rows[0]?.cnt ?? 0))
        setLoading(false)
      }
    } catch {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    runQuery()
  }, [runQuery])

  useEffect(() => {
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.includes('conversations')) {
        runQuery()
      }
    })
    return unsub
  }, [runQuery])

  return { count, loading }
}
