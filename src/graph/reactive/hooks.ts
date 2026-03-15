/**
 * Reactive DuckDB Hooks
 *
 * React hooks that re-run queries when relevant graph tables change.
 * Built on GraphEventBus's `graph:tables:changed` event.
 *
 * Usage:
 *   const entities = useGraphQuery<EntityRow>(
 *     "SELECT * FROM nodes WHERE list_contains(labels, 'entity') ORDER BY updated_at DESC",
 *     [],
 *     ['nodes']
 *   )
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { graphEventBus } from '../events'
import type { GraphNode, GraphEdge } from '../types'
import { getGraphService } from '../index'

// ============================================================================
// useGraphQuery — Generic reactive SQL query
// ============================================================================

/**
 * Execute a SQL query against DuckDB and re-run when relevant tables change.
 *
 * @param sql - The SQL query to execute
 * @param deps - React dependency array for the query (e.g. [entityId])
 * @param tables - Table names to watch for changes (e.g. ['nodes', 'edges'])
 * @returns { data, loading, error }
 */
export function useGraphQuery<T = Record<string, unknown>>(
  sql: string,
  deps: unknown[],
  tables: string[]
): { data: T[]; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Track if component is mounted
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Stable reference to tables array
  const tablesRef = useRef(tables)
  tablesRef.current = tables

  const runQuery = useCallback(async () => {
    try {
      const graph = await getGraphService()
      const rows = await graph.query<T>(sql)
      if (mountedRef.current) {
        setData(rows)
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
  }, [sql, ...deps])

  // Initial query
  useEffect(() => {
    setLoading(true)
    runQuery()
  }, [runQuery])

  // Re-run when relevant tables change
  useEffect(() => {
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables: changedTables }) => {
      // Check if any of our watched tables were affected
      const relevant = changedTables.some(t => tablesRef.current.includes(t))
      if (relevant) {
        runQuery()
      }
    })

    return unsub
  }, [runQuery])

  return { data, loading, error }
}

// ============================================================================
// useGraphNode — Single node subscription
// ============================================================================

/**
 * Subscribe to a single node by ID.
 * Re-fetches when the nodes table changes.
 */
export function useGraphNode(nodeId: string | null): {
  node: GraphNode | null
  loading: boolean
  error: Error | null
} {
  const [node, setNode] = useState<GraphNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!nodeId) {
      setNode(null)
      setLoading(false)
      return
    }

    let mounted = true

    const fetch = async () => {
      try {
        const graph = await getGraphService()
        const result = await graph.getNode(nodeId)
        if (mounted) {
          setNode(result)
          setLoading(false)
          setError(null)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      }
    }

    setLoading(true)
    fetch()

    // Re-fetch on node changes
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.includes('nodes')) {
        fetch()
      }
    })

    return () => {
      mounted = false
      unsub()
    }
  }, [nodeId])

  return { node, loading, error }
}

// ============================================================================
// useGraphEdges — Edges for a node
// ============================================================================

/**
 * Subscribe to edges connected to a node.
 * Re-fetches when the edges table changes.
 */
export function useGraphEdges(
  nodeId: string | null,
  type?: string,
  direction?: 'outgoing' | 'incoming' | 'both'
): {
  edges: GraphEdge[]
  loading: boolean
  error: Error | null
} {
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!nodeId) {
      setEdges([])
      setLoading(false)
      return
    }

    let mounted = true

    const fetch = async () => {
      try {
        const graph = await getGraphService()
        const result = await graph.getEdges(nodeId, type, direction)
        if (mounted) {
          setEdges(result)
          setLoading(false)
          setError(null)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setLoading(false)
        }
      }
    }

    setLoading(true)
    fetch()

    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.includes('edges')) {
        fetch()
      }
    })

    return () => {
      mounted = false
      unsub()
    }
  }, [nodeId, type, direction])

  return { edges, loading, error }
}
