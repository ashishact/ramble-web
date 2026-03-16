/**
 * GraphEchartsView — eCharts force-directed graph visualization
 *
 * Progressive data loading:
 *   1. Mount → load 100 most recent nodes + edges between them
 *   2. Click node → expand (fetch edges + neighbors, merge into pools)
 *   3. Search → select → reset graph from that node + neighbors
 *
 * Uses dynamic import('echarts') for code splitting (same pattern as SunburstChart).
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Search, Sparkles, Loader2, X } from 'lucide-react'
import { formatRelativeTime } from '../../program/utils'
import { getGraphService, getEmbeddingListener } from '../../graph'
import { VectorSearch } from '../../graph/embeddings/VectorSearch'

// ============================================================================
// Types (local — matches DuckDB schema)
// ============================================================================

interface GraphNodeRow {
  id: string
  labels: string[]
  properties: Record<string, unknown>
  created_at: number
  updated_at: number
}

interface GraphEdgeRow {
  id: string
  start_id: string
  end_id: string
  type: string
  properties: Record<string, unknown>
  created_at: number
}

interface ParsedNode {
  id: string
  labels: string[]
  props: Record<string, unknown>
  createdAt: number
  updatedAt: number
  title: string
}

// ============================================================================
// Constants
// ============================================================================

const LABEL_COLORS: Record<string, string> = {
  entity:       '#3b82f6',
  person:       '#3b82f6',
  organization: '#6366f1',
  company:      '#6366f1',
  memory:       '#f59e0b',
  fact:         '#10b981',
  event:        '#8b5cf6',
  belief:       '#f97316',
  preference:   '#14b8a6',
  habit:        '#84cc16',
  observation:  '#64748b',
  topic:        '#ec4899',
  goal:         '#06b6d4',
}

const LABEL_STYLES: Record<string, string> = {
  entity:       'bg-blue-100/70 text-blue-700 border-blue-200/50',
  person:       'bg-blue-100/70 text-blue-700 border-blue-200/50',
  organization: 'bg-indigo-100/70 text-indigo-700 border-indigo-200/50',
  company:      'bg-indigo-100/70 text-indigo-700 border-indigo-200/50',
  memory:       'bg-amber-100/70 text-amber-700 border-amber-200/50',
  fact:         'bg-emerald-100/70 text-emerald-700 border-emerald-200/50',
  event:        'bg-purple-100/70 text-purple-700 border-purple-200/50',
  belief:       'bg-orange-100/70 text-orange-700 border-orange-200/50',
  preference:   'bg-teal-100/70 text-teal-700 border-teal-200/50',
  habit:        'bg-lime-100/70 text-lime-700 border-lime-200/50',
  observation:  'bg-slate-100/70 text-slate-600 border-slate-200/50',
  topic:        'bg-pink-100/70 text-pink-700 border-pink-200/50',
  goal:         'bg-cyan-100/70 text-cyan-700 border-cyan-200/50',
}

const SKIP_PROPS = new Set(['name', 'content', 'statement'])

const CATEGORY_LIST = Object.keys(LABEL_COLORS).filter(
  (k, i, arr) => arr.indexOf(k) === i // dedupe (person/entity share color but are separate categories)
)

// ============================================================================
// Helpers
// ============================================================================

function parseNode(row: GraphNodeRow): ParsedNode {
  const props = (row.properties ?? {}) as Record<string, unknown>
  const title =
    (props.name as string) ??
    (props.content as string) ??
    (props.statement as string) ??
    row.id
  return { id: row.id, labels: row.labels, props, createdAt: row.created_at, updatedAt: row.updated_at, title }
}

function nodeColor(labels: string[]): string {
  for (const l of labels) {
    if (LABEL_COLORS[l]) return LABEL_COLORS[l]
  }
  return '#94a3b8'
}

function labelStyle(label: string): string {
  return LABEL_STYLES[label] ?? 'bg-slate-100/70 text-slate-600 border-slate-200/50'
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') {
    if (value > 1e12) return formatRelativeTime(value)
    if (value >= 0 && value <= 1 && !Number.isInteger(value)) return `${(value * 100).toFixed(0)}%`
    return String(value)
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.join(', ')
  }
  return String(value)
}

function formatEdgeType(type: string): string {
  return type.toLowerCase().replace(/_/g, ' ')
}

function symbolSize(edgeCount: number): number {
  return Math.max(15, Math.min(60, 10 + Math.sqrt(edgeCount) * 8))
}

function categoryIndex(labels: string[]): number {
  for (const l of labels) {
    const idx = CATEGORY_LIST.indexOf(l)
    if (idx >= 0) return idx
  }
  return CATEGORY_LIST.length // fallback "other"
}

// ============================================================================
// GraphEchartsView
// ============================================================================

export const GraphEchartsView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import('echarts')['init']> | null>(null)
  const echartsModRef = useRef<typeof import('echarts') | null>(null)
  const [ready, setReady] = useState(false)

  // ── Data pools ────────────────────────────────────────────────────────
  const nodePoolRef = useRef<Map<string, ParsedNode>>(new Map())
  const edgePoolRef = useRef<Map<string, GraphEdgeRow>>(new Map())
  const edgeCountsRef = useRef<Map<string, number>>(new Map())
  const expandedRef = useRef<Set<string>>(new Set())

  // Trigger re-render after pool mutations
  const [poolVersion, setPoolVersion] = useState(0)
  const bumpVersion = useCallback(() => setPoolVersion(v => v + 1), [])

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // ── eCharts init ──────────────────────────────────────────────────────

  useEffect(() => {
    let disposed = false

    async function init() {
      const echarts = await import('echarts')
      if (disposed || !containerRef.current) return

      echartsModRef.current = echarts
      const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' })
      chartRef.current = chart

      // Click → expand node
      chart.on('click', (params: any) => {
        if (params.dataType === 'node') {
          const nodeId = params.data?.id as string
          if (nodeId) {
            setSelectedNodeId(nodeId)
            expandNode(nodeId)
          }
        }
      })

      // Double-click → reset graph from node
      chart.on('dblclick', (params: any) => {
        if (params.dataType === 'node') {
          const nodeId = params.data?.id as string
          if (nodeId) resetFromNode(nodeId)
        }
      })

      setReady(true)
    }

    init().catch(err => console.warn('[GraphEcharts] init failed:', err))

    return () => {
      disposed = true
      if (chartRef.current) {
        chartRef.current.dispose()
        chartRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Resize observer ───────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return
    const ro = new ResizeObserver(() => { chartRef.current?.resize() })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [ready])

  // ── Initial data load ─────────────────────────────────────────────────

  useEffect(() => {
    if (!ready) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const graph = await getGraphService()

        // 1. Fetch 100 most recently updated nodes
        const nodeRows = await graph.query<GraphNodeRow>(
          'SELECT * FROM nodes ORDER BY updated_at DESC LIMIT 100'
        )
        if (cancelled) return

        const nodes = nodeRows.map(parseNode)
        const nodePool = nodePoolRef.current
        for (const n of nodes) nodePool.set(n.id, n)

        // 2. Fetch edges between these nodes
        if (nodes.length > 0) {
          const escaped = nodes.map(n => `'${n.id.replace(/'/g, "''")}'`).join(',')
          const edgeRows = await graph.query<GraphEdgeRow>(
            `SELECT * FROM edges WHERE start_id IN (${escaped}) AND end_id IN (${escaped})`
          )
          if (cancelled) return

          const edgePool = edgePoolRef.current
          for (const e of edgeRows) edgePool.set(e.id, e)
        }

        // 3. Fetch edge counts per node
        if (nodes.length > 0) {
          const escaped = nodes.map(n => `'${n.id.replace(/'/g, "''")}'`).join(',')
          const countRows = await graph.query<{ node_id: string; cnt: number }>(
            `SELECT node_id, COUNT(*) as cnt FROM (
              SELECT start_id as node_id FROM edges WHERE start_id IN (${escaped})
              UNION ALL
              SELECT end_id as node_id FROM edges WHERE end_id IN (${escaped})
            ) GROUP BY node_id`
          )
          if (cancelled) return

          const edgeCounts = edgeCountsRef.current
          for (const r of countRows) edgeCounts.set(r.node_id, Number(r.cnt))
        }

        bumpVersion()
      } catch (err) {
        console.warn('[GraphEcharts] initial load failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [ready, bumpVersion])

  // ── Expand node (fetch edges + neighbors) ─────────────────────────────

  const expandNode = useCallback(async (nodeId: string) => {
    if (expandedRef.current.has(nodeId)) return
    expandedRef.current.add(nodeId)

    try {
      const graph = await getGraphService()

      const edgeRows = await graph.query<GraphEdgeRow>(
        `SELECT * FROM edges WHERE start_id = $1 OR end_id = $1 LIMIT 100`,
        [nodeId]
      )

      const edgePool = edgePoolRef.current
      for (const e of edgeRows) edgePool.set(e.id, e)

      // Find connected node IDs not yet in pool
      const nodePool = nodePoolRef.current
      const missingIds = new Set<string>()
      for (const e of edgeRows) {
        if (!nodePool.has(e.start_id)) missingIds.add(e.start_id)
        if (!nodePool.has(e.end_id)) missingIds.add(e.end_id)
      }

      if (missingIds.size > 0) {
        const escaped = [...missingIds].map(id => `'${id.replace(/'/g, "''")}'`).join(',')
        const newNodes = await graph.query<GraphNodeRow>(
          `SELECT * FROM nodes WHERE id IN (${escaped})`
        )
        for (const row of newNodes) nodePool.set(row.id, parseNode(row))

        // Fetch edge counts for new nodes
        const countRows = await graph.query<{ node_id: string; cnt: number }>(
          `SELECT node_id, COUNT(*) as cnt FROM (
            SELECT start_id as node_id FROM edges WHERE start_id IN (${escaped})
            UNION ALL
            SELECT end_id as node_id FROM edges WHERE end_id IN (${escaped})
          ) GROUP BY node_id`
        )
        const edgeCounts = edgeCountsRef.current
        for (const r of countRows) edgeCounts.set(r.node_id, Number(r.cnt))
      }

      bumpVersion()
    } catch (err) {
      console.warn('[GraphEcharts] expand failed:', err)
    }
  }, [bumpVersion])

  // ── Reset graph from a single node ────────────────────────────────────

  const resetFromNode = useCallback(async (nodeId: string) => {
    nodePoolRef.current.clear()
    edgePoolRef.current.clear()
    edgeCountsRef.current.clear()
    expandedRef.current.clear()
    setSelectedNodeId(nodeId)
    setLoading(true)

    try {
      const graph = await getGraphService()

      // Fetch the node itself
      const [nodeRow] = await graph.query<GraphNodeRow>(
        'SELECT * FROM nodes WHERE id = $1', [nodeId]
      )
      if (!nodeRow) { setLoading(false); bumpVersion(); return }
      nodePoolRef.current.set(nodeId, parseNode(nodeRow))

      // Fetch edges
      const edgeRows = await graph.query<GraphEdgeRow>(
        `SELECT * FROM edges WHERE start_id = $1 OR end_id = $1 LIMIT 100`,
        [nodeId]
      )
      for (const e of edgeRows) edgePoolRef.current.set(e.id, e)

      // Fetch neighbors
      const neighborIds = new Set<string>()
      for (const e of edgeRows) {
        if (e.start_id !== nodeId) neighborIds.add(e.start_id)
        if (e.end_id !== nodeId) neighborIds.add(e.end_id)
      }

      if (neighborIds.size > 0) {
        const escaped = [...neighborIds].map(id => `'${id.replace(/'/g, "''")}'`).join(',')
        const neighborRows = await graph.query<GraphNodeRow>(
          `SELECT * FROM nodes WHERE id IN (${escaped})`
        )
        for (const row of neighborRows) nodePoolRef.current.set(row.id, parseNode(row))

        // Edge counts for all nodes
        const allEscaped = [nodeId, ...neighborIds].map(id => `'${id.replace(/'/g, "''")}'`).join(',')
        const countRows = await graph.query<{ node_id: string; cnt: number }>(
          `SELECT node_id, COUNT(*) as cnt FROM (
            SELECT start_id as node_id FROM edges WHERE start_id IN (${allEscaped})
            UNION ALL
            SELECT end_id as node_id FROM edges WHERE end_id IN (${allEscaped})
          ) GROUP BY node_id`
        )
        for (const r of countRows) edgeCountsRef.current.set(r.node_id, Number(r.cnt))
      }

      expandedRef.current.add(nodeId)
      bumpVersion()
    } catch (err) {
      console.warn('[GraphEcharts] reset failed:', err)
    } finally {
      setLoading(false)
    }
  }, [bumpVersion])

  // ── Build eCharts option from pools ───────────────────────────────────

  useEffect(() => {
    if (!ready || !chartRef.current) return
    const chart = chartRef.current
    const nodePool = nodePoolRef.current
    const edgePool = edgePoolRef.current
    const edgeCounts = edgeCountsRef.current

    // Categories
    const categories = [
      ...CATEGORY_LIST.map(label => ({
        name: label,
        itemStyle: { color: LABEL_COLORS[label] },
      })),
      { name: 'other', itemStyle: { color: '#94a3b8' } },
    ]

    // Nodes
    const nodes = [...nodePool.values()].map(n => {
      const ec = edgeCounts.get(n.id) ?? 0
      return {
        id: n.id,
        name: n.title.length > 40 ? n.title.slice(0, 39) + '…' : n.title,
        symbolSize: symbolSize(ec),
        category: categoryIndex(n.labels),
        label: {
          show: ec > 3,
        },
        itemStyle: {
          color: nodeColor(n.labels),
          borderColor: n.id === selectedNodeId ? '#1e293b' : undefined,
          borderWidth: n.id === selectedNodeId ? 2 : 0,
        },
      }
    })

    // Edges
    const nodeIds = new Set(nodePool.keys())
    const links = [...edgePool.values()]
      .filter(e => nodeIds.has(e.start_id) && nodeIds.has(e.end_id))
      .map(e => ({
        source: e.start_id,
        target: e.end_id,
        value: formatEdgeType(e.type),
      }))

    chart.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(30, 30, 40, 0.92)',
        borderColor: 'rgba(255,255,255,0.08)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        formatter: (params: any) => {
          if (params.dataType === 'edge') {
            return `<span style="color:#94a3b8">${params.data.value}</span>`
          }
          const nodeId = params.data?.id as string
          const n = nodePool.get(nodeId)
          if (!n) return params.name
          const ec = edgeCounts.get(nodeId) ?? 0
          return [
            `<strong>${n.title.length > 60 ? n.title.slice(0, 59) + '…' : n.title}</strong>`,
            `<span style="color:#94a3b8">${n.labels.join(' · ')}</span>`,
            `${ec} connection${ec !== 1 ? 's' : ''}`,
          ].join('<br/>')
        },
      },
      legend: {
        data: categories.map(c => c.name),
        bottom: 0,
        type: 'scroll',
        textStyle: { fontSize: 10, color: '#94a3b8' },
        itemWidth: 10,
        itemHeight: 10,
      },
      animationDuration: 500,
      animationEasingUpdate: 'quinticInOut',
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        data: nodes,
        links,
        categories,
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 3 },
        },
        force: {
          repulsion: 120,
          gravity: 0.05,
          edgeLength: [60, 200],
          layoutAnimation: true,
        },
        lineStyle: {
          curveness: 0.3,
          color: 'source',
          opacity: 0.6,
        },
        label: {
          position: 'right',
          formatter: '{b}',
          fontSize: 10,
          color: '#475569',
        },
        edgeLabel: {
          show: false,
        },
      }],
    }, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, poolVersion, selectedNodeId])

  // ── Search ────────────────────────────────────────────────────────────

  const [searchQuery, setSearchQuery] = useState('')
  const vectorSearchRef = useRef<VectorSearch | null>(null)
  const [stringResults, setStringResults] = useState<ParsedNode[]>([])
  const [vectorResults, setVectorResults] = useState<{ node: ParsedNode; similarity: number }[]>([])
  const [vectorSearching, setVectorSearching] = useState(false)

  // String search
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) { setStringResults([]); return }

    const timer = setTimeout(async () => {
      try {
        const graph = await getGraphService()
        const rows = await graph.query<GraphNodeRow>(
          `SELECT * FROM nodes
           WHERE json_extract_string(properties, '$.name') ILIKE $1
              OR json_extract_string(properties, '$.content') ILIKE $1
              OR json_extract_string(properties, '$.statement') ILIKE $1
           ORDER BY updated_at DESC LIMIT 10`,
          [`%${q}%`]
        )
        setStringResults(rows.map(parseNode))
      } catch {
        setStringResults([])
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Vector search
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 3) { setVectorResults([]); return }

    const timer = setTimeout(async () => {
      try {
        if (!vectorSearchRef.current) {
          const [graph, listener] = await Promise.all([getGraphService(), getEmbeddingListener()])
          vectorSearchRef.current = new VectorSearch(graph, listener.getService())
        }
        setVectorSearching(true)
        const results = await vectorSearchRef.current.searchByText(q, 15)
        setVectorResults(results.map(r => {
          const props = r.node.properties ?? {}
          const title = (props.name as string) ?? (props.content as string) ?? (props.statement as string) ?? r.node.id
          return {
            node: { id: r.node.id, labels: r.node.labels, props, createdAt: r.node.created_at, updatedAt: r.node.updated_at, title },
            similarity: r.similarity,
          }
        }))
      } catch {
        setVectorResults([])
      } finally {
        setVectorSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Merge search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return []
    const stringMatchIds = new Set(stringResults.map(n => n.id))
    const semanticOnly = vectorResults
      .filter(r => !stringMatchIds.has(r.node.id))
      .slice(0, 6)
    return [
      ...stringResults.map(n => ({ ...n, similarity: undefined as number | undefined })),
      ...semanticOnly.map(r => ({ ...r.node, similarity: r.similarity as number | undefined })),
    ]
  }, [searchQuery, stringResults, vectorResults])

  const handleSearchSelect = useCallback((nodeId: string) => {
    setSearchQuery('')
    resetFromNode(nodeId)
  }, [resetFromNode])

  // ── Selected node for properties panel ────────────────────────────────

  const selectedNode = selectedNodeId ? nodePoolRef.current.get(selectedNodeId) ?? null : null
  const propsEntries = selectedNode
    ? Object.entries(selectedNode.props).filter(([key]) => !SKIP_PROPS.has(key))
    : []

  // ── Stats ─────────────────────────────────────────────────────────────

  const nodeCount = nodePoolRef.current.size
  const edgeCount = edgePoolRef.current.size

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center gap-1.5 relative">
        <Search size={10} className="text-slate-300 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Jump to node..."
          className="text-[10px] text-slate-600 bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-slate-300"
        />
        {vectorSearching && (
          <Sparkles size={9} className="text-violet-400 animate-pulse shrink-0" />
        )}
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-[9px] text-slate-300 hover:text-slate-500 shrink-0">
            <X size={10} />
          </button>
        )}
        {searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-20 bg-white border border-slate-200 rounded-b shadow-lg max-h-48 overflow-auto">
            {searchResults.map(n => (
              <button
                key={n.id}
                onClick={() => handleSearchSelect(n.id)}
                className="w-full text-left px-2 py-1 hover:bg-slate-50 flex items-center gap-1.5"
              >
                {n.labels.map(l => (
                  <span key={l} className={`text-[8px] px-1 py-px rounded border font-medium shrink-0 ${labelStyle(l)}`}>{l}</span>
                ))}
                <span className="text-[10px] text-slate-700 truncate flex-1 min-w-0">{n.title}</span>
                {n.similarity != null && (
                  <span className="flex items-center gap-0.5 text-[8px] text-violet-500 bg-violet-50 px-1 py-[1px] rounded border border-violet-200/50 shrink-0">
                    <Sparkles size={7} />
                    {(n.similarity * 100).toFixed(0)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart area */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/60">
            <Loader2 size={16} className="animate-spin text-slate-400" />
          </div>
        )}

        <div ref={containerRef} className="w-full h-full" />

        {/* Properties panel */}
        {selectedNode && propsEntries.length > 0 && (
          <div className="absolute bottom-1 left-1 right-1 z-10 bg-white/90 backdrop-blur-sm border border-slate-200/80 rounded-md px-2 py-1.5 max-h-[35%] overflow-auto">
            <div className="flex items-center gap-1 mb-1">
              {selectedNode.labels.map(l => (
                <span key={l} className={`text-[8px] px-1 py-px rounded border font-medium ${labelStyle(l)}`}>{l}</span>
              ))}
              <span className="text-[10px] text-slate-700 font-medium truncate flex-1 min-w-0">{selectedNode.title}</span>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="text-slate-300 hover:text-slate-500 shrink-0 transition-colors"
              >
                <X size={10} />
              </button>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-px">
              {propsEntries.map(([key, value]) => (
                <div key={key} className="contents">
                  <span className="text-[8px] text-slate-400 text-right whitespace-nowrap leading-[15px]">{key}</span>
                  <span className="text-[9px] text-slate-600 truncate leading-[15px]">{formatValue(value)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 pt-0.5 border-t border-slate-100/60 text-[7px] text-slate-300 font-mono select-all">
              {selectedNode.id} · {formatRelativeTime(selectedNode.updatedAt)}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-2 py-0.5 text-[9px] text-slate-400 border-t border-slate-100 flex items-center gap-2">
        <span>{nodeCount} nodes</span>
        <span className="text-slate-300">·</span>
        <span>{edgeCount} edges</span>
        <span className="text-slate-300">·</span>
        <span>click to expand · dblclick to reset</span>
      </div>
    </div>
  )
}
