import { useState, useMemo, useCallback, useEffect, useRef, createContext, useContext } from 'react';
import type { WidgetProps } from '../types';
import { useGraphQuery } from '../../graph/reactive/hooks';
import { formatRelativeTime } from '../../program/utils';
import { getGraphService, getEmbeddingListener } from '../../graph';
import { VectorSearch } from '../../graph/embeddings/VectorSearch';
import { GitBranch, ChevronRight, ChevronDown, Search, ArrowUpDown, Sparkles, Loader2, Network, List } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface GraphNodeRow {
  id: string
  labels: string[]
  properties: string | Record<string, unknown>
  created_at: number
  updated_at: number
}

interface GraphEdgeRow {
  id: string
  start_id: string
  end_id: string
  type: string
  properties: string | Record<string, unknown>
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

interface EdgeInfo {
  id: string
  type: string
  direction: 'outgoing' | 'incoming'
  connectedNodeId: string
  props: Record<string, unknown>
}

// ============================================================================
// Constants
// ============================================================================

const MAX_DEPTH = 6
const INITIAL_EDGES_SHOWN = 5
const MAX_EDGES_PER_NODE = 50
const EMPTY_SET: Set<string> = new Set()

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

const DEPTH_COLORS = [
  'border-blue-300',
  'border-violet-300',
  'border-amber-300',
  'border-emerald-300',
  'border-pink-300',
  'border-cyan-300',
]

const SKIP_PROPS = new Set(['name', 'content', 'statement'])

// ============================================================================
// Explorer Context — shared state for recursive node components
// ============================================================================

interface ExplorerContextValue {
  nodeMap: Map<string, ParsedNode>
  edgeCache: Map<string, EdgeInfo[]>
  loadingEdges: Set<string>
  expandedIds: Set<string>
  toggleExpand: (id: string) => void
  fetchEdgesFor: (id: string) => void
  similarityMap: Map<string, number>
}

const ExplorerCtx = createContext<ExplorerContextValue>(null!)

// ============================================================================
// Helpers
// ============================================================================

function parseNode(row: GraphNodeRow): ParsedNode {
  const props = typeof row.properties === 'string'
    ? JSON.parse(row.properties)
    : (row.properties ?? {})

  const title =
    (props.name as string) ??
    (props.content as string) ??
    (props.statement as string) ??
    row.id

  return {
    id: row.id,
    labels: row.labels,
    props,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title,
  }
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

function depthColor(depth: number): string {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length]
}

// ============================================================================
// NodeProperties — expandable property grid
// ============================================================================

const NodeProperties: React.FC<{ node: ParsedNode }> = ({ node }) => {
  const entries = Object.entries(node.props).filter(([key]) => !SKIP_PROPS.has(key))
  if (entries.length === 0) return null

  return (
    <div className="ml-5 mr-1 my-0.5 px-2 py-1.5 bg-slate-50/40 rounded border border-slate-100/80">
      {node.title.length > 60 && (
        <p className="text-[10px] text-slate-600 leading-relaxed mb-1.5 whitespace-pre-wrap">{node.title}</p>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-px">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <span className="text-[8px] text-slate-400 text-right whitespace-nowrap leading-[15px]">{key}</span>
            <span className="text-[9px] text-slate-600 truncate leading-[15px]">{formatValue(value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 pt-1 border-t border-slate-100/60 flex items-center gap-3 text-[7px] text-slate-300 font-mono select-all">
        <span>{node.id}</span>
        <span>{formatRelativeTime(node.createdAt)}</span>
      </div>
    </div>
  )
}

// ============================================================================
// EdgeGroupSection — one edge type (e.g. "→ knows · 3")
// ============================================================================

const EdgeGroupSection: React.FC<{
  type: string
  direction: 'outgoing' | 'incoming'
  edges: EdgeInfo[]
  depth: number
  ancestorIds: Set<string>
}> = ({ type, direction, edges, depth, ancestorIds }) => {
  const [showAll, setShowAll] = useState(false)
  const displayed = showAll ? edges : edges.slice(0, INITIAL_EDGES_SHOWN)
  const remaining = edges.length - INITIAL_EDGES_SHOWN

  return (
    <div className="mt-0.5">
      {/* Edge group header */}
      <div className="flex items-center gap-1.5 px-2 py-[3px]">
        <span className={`text-[10px] font-mono leading-none ${direction === 'outgoing' ? 'text-blue-400' : 'text-amber-400'}`}>
          {direction === 'outgoing' ? '→' : '←'}
        </span>
        <span className="text-[8px] text-slate-400 font-medium tracking-wide uppercase">{formatEdgeType(type)}</span>
        <span className="text-[8px] text-slate-300 font-mono">{edges.length}</span>
        <div className="flex-1 border-t border-dashed border-slate-100" />
      </div>

      {/* Connected nodes */}
      <div className="ml-1">
        {displayed.map(edge => {
          if (ancestorIds.has(edge.connectedNodeId)) {
            return (
              <div key={edge.id} className="flex items-center gap-1.5 px-3 py-[2px]">
                <span className="text-[8px] text-slate-300 italic">circular ref</span>
              </div>
            )
          }
          return (
            <GraphExplorerNode
              key={edge.id}
              nodeId={edge.connectedNodeId}
              depth={depth + 1}
              ancestorIds={ancestorIds}
            />
          )
        })}
      </div>

      {!showAll && remaining > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="ml-4 px-2 py-0.5 text-[8px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors"
        >
          +{remaining} more...
        </button>
      )}
    </div>
  )
}

// ============================================================================
// GraphExplorerNode — recursive node with lazy edge loading
// ============================================================================

const GraphExplorerNode: React.FC<{
  nodeId: string
  depth: number
  ancestorIds: Set<string>
  similarity?: number
}> = ({ nodeId, depth, ancestorIds, similarity }) => {
  const ctx = useContext(ExplorerCtx)
  const { nodeMap, edgeCache, loadingEdges, expandedIds, toggleExpand, fetchEdgesFor } = ctx

  const node = nodeMap.get(nodeId)
  if (!node) return null

  const isExpanded = expandedIds.has(nodeId)
  const edges = edgeCache.get(nodeId)
  const isLoading = loadingEdges.has(nodeId)
  const atMaxDepth = depth >= MAX_DEPTH

  // Fetch edges when first expanded
  useEffect(() => {
    if (isExpanded && !edges && !isLoading) {
      fetchEdgesFor(nodeId)
    }
  }, [isExpanded, nodeId, edges, isLoading, fetchEdgesFor])

  const handleToggle = useCallback(() => {
    if (atMaxDepth) return
    toggleExpand(nodeId)
  }, [nodeId, atMaxDepth, toggleExpand])

  // Group edges by direction:type
  const edgeGroups = useMemo(() => {
    if (!edges) return []
    const groups = new Map<string, { type: string; direction: 'outgoing' | 'incoming'; edges: EdgeInfo[] }>()
    for (const e of edges) {
      const key = `${e.direction}:${e.type}`
      if (!groups.has(key)) groups.set(key, { type: e.type, direction: e.direction, edges: [] })
      groups.get(key)!.edges.push(e)
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'outgoing' ? -1 : 1
      return a.type.localeCompare(b.type)
    })
  }, [edges])

  const stateVal = node.props.state as string | undefined
  const stateClass =
    stateVal === 'superseded' ? 'line-through text-red-400/70' :
    stateVal === 'retracted' ? 'line-through text-slate-300 opacity-40' :
    stateVal === 'contested' ? 'text-amber-600' :
    ''

  const newAncestors = useMemo(() => new Set([...ancestorIds, nodeId]), [ancestorIds, nodeId])

  return (
    <div className={depth > 0 ? `ml-4 pl-2.5 border-l-2 ${depthColor(depth)}` : ''}>
      {/* Node row */}
      <div
        onClick={handleToggle}
        className={`
          flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors group
          ${atMaxDepth ? 'cursor-default opacity-50' : 'cursor-pointer hover:bg-slate-50/80'}
          ${isExpanded ? 'bg-slate-50/50' : ''}
        `}
      >
        {/* Expand chevron */}
        {!atMaxDepth ? (
          <span className="text-slate-300 group-hover:text-slate-400 shrink-0 w-3.5 flex justify-center transition-colors">
            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Label tags */}
        {node.labels.map(label => (
          <span
            key={label}
            className={`text-[8px] px-1 py-px rounded border font-medium shrink-0 leading-tight ${labelStyle(label)}`}
          >
            {label}
          </span>
        ))}

        {/* Title — proper ellipsis */}
        <span className={`text-[10px] leading-tight text-slate-700 truncate min-w-0 flex-1 ${stateClass}`}>
          {node.title}
        </span>

        {/* Similarity badge */}
        {similarity != null && (
          <span
            className="flex items-center gap-0.5 text-[8px] text-violet-500 bg-violet-50 px-1 py-[1px] rounded border border-violet-200/50 shrink-0"
            title={`Semantic similarity: ${(similarity * 100).toFixed(0)}%`}
          >
            <Sparkles size={8} />
            {(similarity * 100).toFixed(0)}%
          </span>
        )}

        {/* Edge count indicator (when collapsed, if edges are cached) */}
        {!isExpanded && edges && edges.length > 0 && (
          <span className="text-[8px] text-slate-300 shrink-0 font-mono">{edges.length}</span>
        )}

        {/* Timestamp */}
        <span className="text-[8px] text-slate-300 shrink-0 tabular-nums">
          {formatRelativeTime(node.updatedAt)}
        </span>
      </div>

      {/* Expanded: properties + edges */}
      {isExpanded && (
        <div className="mb-0.5">
          <NodeProperties node={node} />

          {isLoading && (
            <div className="flex items-center gap-1.5 px-3 py-1">
              <Loader2 size={10} className="animate-spin text-slate-300" />
              <span className="text-[8px] text-slate-300">Loading connections...</span>
            </div>
          )}

          {edges && edgeGroups.length === 0 && !isLoading && (
            <div className="px-3 py-1">
              <span className="text-[8px] text-slate-300 italic">No connections</span>
            </div>
          )}

          {edgeGroups.map(group => (
            <EdgeGroupSection
              key={`${group.direction}:${group.type}`}
              type={group.type}
              direction={group.direction}
              edges={group.edges}
              depth={depth}
              ancestorIds={newAncestors}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// GraphNetworkView — SVG radial graph with selected node + 1-layer neighbors
// ============================================================================

interface NeighborNode {
  node: ParsedNode
  edgeType: string
  edgeDirection: 'outgoing' | 'incoming'
  edgeCount: number // how many edges this neighbor itself has
}

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

function nodeFillColor(labels: string[]): string {
  for (const l of labels) {
    if (LABEL_COLORS[l]) return LABEL_COLORS[l]
  }
  return '#94a3b8'
}

function nodeFillBg(labels: string[]): string {
  const hex = nodeFillColor(labels)
  return hex + '18' // very low opacity for fill
}

const GraphNetworkView: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<ParsedNode | null>(null)
  const [neighbors, setNeighbors] = useState<NeighborNode[]>([])
  const [loading, setLoading] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 })

  // Measure container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setDimensions({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Pick default node on mount
  useEffect(() => {
    if (selectedId) return
    let cancelled = false
    ;(async () => {
      try {
        const graph = await getGraphService()
        const rows = await graph.query<GraphNodeRow>(
          'SELECT * FROM nodes ORDER BY updated_at DESC LIMIT 1'
        )
        if (!cancelled && rows.length > 0) setSelectedId(rows[0].id)
      } catch (err) {
        console.warn('[GraphNetwork] Failed to pick default node:', err)
      }
    })()
    return () => { cancelled = true }
  }, [selectedId])

  // Fetch selected node + neighbors when selectedId changes
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const graph = await getGraphService()

        // 1. Fetch the selected node itself
        const [nodeRow] = await graph.query<GraphNodeRow>(
          'SELECT * FROM nodes WHERE id = $1',
          [selectedId]
        )
        if (!nodeRow) {
          if (!cancelled) { setSelectedNode(null); setNeighbors([]) }
          return
        }
        if (!cancelled) setSelectedNode(parseNode(nodeRow))

        // 2. Fetch edges for this node
        const edgeRows = await graph.query<GraphEdgeRow>(
          `SELECT * FROM edges WHERE start_id = $1 OR end_id = $1 LIMIT ${MAX_EDGES_PER_NODE}`,
          [selectedId]
        )

        // 3. Determine connected node IDs + edge info (keep first edge per neighbor)
        const connectedMap = new Map<string, { edgeType: string; edgeDirection: 'outgoing' | 'incoming' }>()
        for (const e of edgeRows) {
          const isOutgoing: boolean = e.start_id === selectedId
          const connectedId: string = isOutgoing ? e.end_id : e.start_id
          if (connectedId === selectedId) continue // skip self-loops
          if (!connectedMap.has(connectedId)) {
            connectedMap.set(connectedId, {
              edgeType: e.type,
              edgeDirection: isOutgoing ? 'outgoing' : 'incoming',
            })
          }
        }

        const neighborIds = [...connectedMap.keys()]
        if (neighborIds.length === 0) {
          if (!cancelled) setNeighbors([])
          return
        }

        // 4. Fetch neighbor nodes + their edge counts in one query
        //    DuckDB WASM can't bind arrays, so inline the IDs safely
        const escaped = neighborIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')

        const neighborRows = await graph.query<GraphNodeRow & { edge_count: number }>(
          `SELECT n.*, (
            SELECT COUNT(*) FROM edges e
            WHERE e.start_id = n.id OR e.end_id = n.id
          ) as edge_count
          FROM nodes n
          WHERE n.id IN (${escaped})`
        )

        if (cancelled) return

        const nodeById = new Map(neighborRows.map(r => [r.id, r]))
        const result: NeighborNode[] = []
        for (const [id, info] of connectedMap) {
          const row = nodeById.get(id)
          if (!row) continue
          result.push({
            node: parseNode(row),
            edgeType: info.edgeType,
            edgeDirection: info.edgeDirection,
            edgeCount: Number(row.edge_count),
          })
        }

        setNeighbors(result)
      } catch (err) {
        console.warn('[GraphNetwork] Failed to load neighbors:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedId])

  // Layout calculation
  const { cx, cy, neighborPositions } = useMemo(() => {
    const { width, height } = dimensions
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) * 0.34
    const count = neighbors.length

    const neighborPositions = neighbors.map((n, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2 // start from top
      return {
        ...n,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      }
    })

    return { cx, cy, neighborPositions }
  }, [dimensions, neighbors])

  const handleNodeClick = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  // ── Search: string (DuckDB) + vector ────────────────────────────────
  const [graphSearch, setGraphSearch] = useState('')
  const graphVectorSearchRef = useRef<VectorSearch | null>(null)
  const [stringResults, setStringResults] = useState<ParsedNode[]>([])
  const [vectorResults, setVectorResults] = useState<{ node: ParsedNode; similarity: number }[]>([])
  const [vectorSearching, setVectorSearching] = useState(false)

  // String search — query DuckDB
  useEffect(() => {
    const q = graphSearch.trim()
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
  }, [graphSearch])

  // Vector search
  useEffect(() => {
    const q = graphSearch.trim()
    if (q.length < 3) { setVectorResults([]); return }

    const timer = setTimeout(async () => {
      try {
        if (!graphVectorSearchRef.current) {
          const [graph, listener] = await Promise.all([getGraphService(), getEmbeddingListener()])
          graphVectorSearchRef.current = new VectorSearch(graph, listener.getService())
        }
        setVectorSearching(true)
        const results = await graphVectorSearchRef.current.searchByText(q, 15)
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
  }, [graphSearch])

  // Merge string + vector results
  const searchResults = useMemo(() => {
    const q = graphSearch.trim()
    if (!q) return []

    const stringMatchIds = new Set(stringResults.map(n => n.id))

    // Semantic-only hits (not already in string matches)
    const semanticOnly = vectorResults
      .filter(r => !stringMatchIds.has(r.node.id))
      .slice(0, 6)

    return [
      ...stringResults.map(n => ({ ...n, similarity: undefined as number | undefined })),
      ...semanticOnly.map(r => ({ ...r.node, similarity: r.similarity as number | undefined })),
    ]
  }, [graphSearch, stringResults, vectorResults])

  if (!selectedNode) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
        {loading ? <Loader2 size={16} className="animate-spin" /> : 'No node selected'}
      </div>
    )
  }

  const propsEntries = Object.entries(selectedNode.props).filter(([key]) => !SKIP_PROPS.has(key))

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center gap-1.5 relative">
        <Search size={10} className="text-slate-300 shrink-0" />
        <input
          type="text"
          value={graphSearch}
          onChange={e => setGraphSearch(e.target.value)}
          placeholder="Jump to node..."
          className="text-[10px] text-slate-600 bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-slate-300"
        />
        {vectorSearching && (
          <Sparkles size={9} className="text-violet-400 animate-pulse shrink-0" />
        )}
        {graphSearch && (
          <button onClick={() => setGraphSearch('')} className="text-[9px] text-slate-300 hover:text-slate-500 shrink-0">✕</button>
        )}
        {searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-20 bg-white border border-slate-200 rounded-b shadow-lg max-h-48 overflow-auto">
            {searchResults.map(n => (
              <button
                key={n.id}
                onClick={() => { handleNodeClick(n.id); setGraphSearch('') }}
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

      {/* Graph area */}
      <div className="flex-1 relative overflow-hidden min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/60">
            <Loader2 size={16} className="animate-spin text-slate-400" />
          </div>
        )}

        <svg width={dimensions.width} height={dimensions.height} className="absolute inset-0">
          {/* Edges (lines from center to neighbors) */}
          {neighborPositions.map((np, i) => (
            <g key={np.node.id + '-edge-' + i}>
              <line
                x1={cx}
                y1={cy}
                x2={np.x}
                y2={np.y}
                stroke={hoveredId === np.node.id ? '#94a3b8' : '#e2e8f0'}
                strokeWidth={hoveredId === np.node.id ? 1.5 : 1}
                strokeDasharray={np.edgeDirection === 'incoming' ? '4,3' : undefined}
              />
              {/* Edge type label at midpoint */}
              <text
                x={(cx + np.x) / 2}
                y={(cy + np.y) / 2 - 4}
                textAnchor="middle"
                className="fill-slate-300 pointer-events-none select-none"
                fontSize={7}
              >
                {np.edgeDirection === 'incoming' ? '← ' : '→ '}{formatEdgeType(np.edgeType)}
              </text>
            </g>
          ))}

          {/* Neighbor nodes */}
          {neighborPositions.map(np => {
            const isHovered = hoveredId === np.node.id
            const color = nodeFillColor(np.node.labels)
            const nodeRadius = isHovered ? 26 : 22
            return (
              <g
                key={np.node.id}
                onClick={() => handleNodeClick(np.node.id)}
                onMouseEnter={() => setHoveredId(np.node.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer"
              >
                {/* Outer ring */}
                <circle
                  cx={np.x}
                  cy={np.y}
                  r={nodeRadius}
                  fill="white"
                  stroke={color}
                  strokeWidth={isHovered ? 2 : 1.5}
                  opacity={isHovered ? 1 : 0.85}
                />
                {/* Title */}
                <text
                  x={np.x}
                  y={np.y - 4}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  fontWeight={600}
                  fill={color}
                  className="pointer-events-none select-none"
                >
                  {np.node.title.length > 12 ? np.node.title.slice(0, 11) + '…' : np.node.title}
                </text>
                {/* Labels row */}
                <text
                  x={np.x}
                  y={np.y + 8}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={7}
                  fill="#94a3b8"
                  className="pointer-events-none select-none"
                >
                  {np.node.labels.join(' · ')}
                </text>
                {/* Edge count badge */}
                <g>
                  <circle cx={np.x + nodeRadius - 4} cy={np.y - nodeRadius + 4} r={7} fill={color} opacity={0.8} />
                  <text
                    x={np.x + nodeRadius - 4}
                    y={np.y - nodeRadius + 4}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={7}
                    fontWeight={700}
                    fill="white"
                    className="pointer-events-none select-none"
                  >
                    {np.edgeCount}
                  </text>
                </g>
              </g>
            )
          })}

          {/* Center node */}
          <circle
            cx={cx}
            cy={cy}
            r={36}
            fill={nodeFillBg(selectedNode.labels)}
            stroke={nodeFillColor(selectedNode.labels)}
            strokeWidth={2.5}
          />
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={700}
            fill={nodeFillColor(selectedNode.labels)}
            className="pointer-events-none select-none"
          >
            {selectedNode.title.length > 16 ? selectedNode.title.slice(0, 15) + '…' : selectedNode.title}
          </text>
          <text
            x={cx}
            y={cy + 8}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8}
            fill="#64748b"
            className="pointer-events-none select-none"
          >
            {selectedNode.labels.join(' · ')}
          </text>
          <text
            x={cx}
            y={cy + 20}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={7}
            fill="#94a3b8"
            className="pointer-events-none select-none"
          >
            {neighbors.length} connection{neighbors.length !== 1 ? 's' : ''}
          </text>
        </svg>

        {/* Selected node properties panel */}
        {propsEntries.length > 0 && (
          <div className="absolute bottom-1 left-1 right-1 z-10 bg-white/90 backdrop-blur-sm border border-slate-200/80 rounded-md px-2 py-1.5 max-h-[35%] overflow-auto">
            <div className="flex items-center gap-1 mb-1">
              {selectedNode.labels.map(l => (
                <span key={l} className={`text-[8px] px-1 py-px rounded border font-medium ${labelStyle(l)}`}>{l}</span>
              ))}
              <span className="text-[10px] text-slate-700 font-medium truncate">{selectedNode.title}</span>
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
        <span>{neighbors.length} neighbors</span>
        <span className="text-slate-300">·</span>
        <span>click a node to explore</span>
      </div>
    </div>
  )
}

// ============================================================================
// Main Widget
// ============================================================================

export const KnowledgeTreeWidget: React.FC<WidgetProps> = ({ config, onConfigChange }) => {
  const { data: rawNodes } = useGraphQuery<GraphNodeRow>(
    'SELECT * FROM nodes ORDER BY updated_at DESC LIMIT 1000',
    [],
    ['nodes']
  )

  const allNodes = useMemo(() => rawNodes.map(parseNode), [rawNodes])

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<'updated' | 'label' | 'created'>(
    (config?.sortMode as 'updated' | 'label' | 'created') ?? 'updated'
  )
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>(
    (config?.viewMode as 'tree' | 'graph') ?? 'tree'
  )

  const handleViewModeToggle = useCallback(() => {
    setViewMode(prev => {
      const next = prev === 'tree' ? 'graph' : 'tree'
      if (onConfigChange) onConfigChange({ ...config, viewMode: next })
      return next
    })
  }, [config, onConfigChange])

  // ── Node cache: initial query + lazy-fetched via edge traversal ───────
  const [fetchedNodes, setFetchedNodes] = useState<Map<string, ParsedNode>>(new Map())

  const nodeMap = useMemo(() => {
    const map = new Map<string, ParsedNode>()
    for (const n of allNodes) map.set(n.id, n)
    for (const [id, n] of fetchedNodes) map.set(id, n)
    return map
  }, [allNodes, fetchedNodes])

  // ── Edge cache: lazy-loaded on node expand ────────────────────────────
  const [edgeCache, setEdgeCache] = useState<Map<string, EdgeInfo[]>>(new Map())
  const [loadingEdges, setLoadingEdges] = useState<Set<string>>(new Set())

  // Refs for stable fetchEdgesFor callback
  const nodeMapRef = useRef(nodeMap)
  nodeMapRef.current = nodeMap
  const edgeCacheRef = useRef(edgeCache)
  edgeCacheRef.current = edgeCache

  const fetchEdgesFor = useCallback(async (nodeId: string) => {
    if (edgeCacheRef.current.has(nodeId)) return

    setLoadingEdges(prev => new Set(prev).add(nodeId))
    try {
      const graph = await getGraphService()
      const edgeRows = await graph.query<GraphEdgeRow>(
        `SELECT * FROM edges WHERE start_id = $1 OR end_id = $1 LIMIT ${MAX_EDGES_PER_NODE}`,
        [nodeId]
      )

      const edgeInfos: EdgeInfo[] = edgeRows.map(e => {
        const direction: 'outgoing' | 'incoming' = e.start_id === nodeId ? 'outgoing' : 'incoming'
        return {
          id: e.id,
          type: e.type,
          direction,
          connectedNodeId: direction === 'outgoing' ? e.end_id : e.start_id,
          props: typeof e.properties === 'string' ? JSON.parse(e.properties) : (e.properties ?? {}),
        }
      })

      // Fetch connected nodes not yet in our cache
      const currentMap = nodeMapRef.current
      const unknownIds = [...new Set(edgeInfos.map(e => e.connectedNodeId))]
        .filter(id => !currentMap.has(id))

      if (unknownIds.length > 0) {
        const placeholders = unknownIds.map((_, i) => `$${i + 1}`).join(',')
        const newRows = await graph.query<GraphNodeRow>(
          `SELECT * FROM nodes WHERE id IN (${placeholders})`,
          unknownIds
        )
        setFetchedNodes(prev => {
          const next = new Map(prev)
          for (const row of newRows) next.set(row.id, parseNode(row))
          return next
        })
      }

      setEdgeCache(prev => new Map(prev).set(nodeId, edgeInfos))
    } catch (err) {
      console.warn('[KnowledgeTree] Failed to load edges:', err)
    } finally {
      setLoadingEdges(prev => {
        const next = new Set(prev)
        next.delete(nodeId)
        return next
      })
    }
  }, [])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ── Vector search (semantic) ──────────────────────────────────────────
  const vectorSearchRef = useRef<VectorSearch | null>(null)
  const [vectorHits, setVectorHits] = useState<Map<string, number>>(new Map())
  const [vectorSearching, setVectorSearching] = useState(false)
  const [vectorMs, setVectorMs] = useState<number | null>(null)

  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 3) {
      setVectorHits(new Map())
      setVectorMs(null)
      return
    }

    const timer = setTimeout(async () => {
      try {
        if (!vectorSearchRef.current) {
          const [graph, listener] = await Promise.all([getGraphService(), getEmbeddingListener()])
          vectorSearchRef.current = new VectorSearch(graph, listener.getService())
        }

        setVectorSearching(true)
        const t0 = performance.now()
        const results = await vectorSearchRef.current.searchByText(q, 30)
        setVectorMs(Math.round(performance.now() - t0))
        setVectorHits(new Map(results.map(r => [r.node.id, r.similarity])))
      } catch {
        setVectorHits(new Map())
        setVectorMs(null)
      } finally {
        setVectorSearching(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // ── Filter + sort + merge ─────────────────────────────────────────────
  const { displayNodes, similarityMap } = useMemo(() => {
    if (!searchQuery.trim()) {
      const sorted = [...allNodes]
      switch (sortMode) {
        case 'label':
          sorted.sort((a, b) => a.labels[0]?.localeCompare(b.labels[0] ?? '') ?? 0)
          break
        case 'created':
          sorted.sort((a, b) => b.createdAt - a.createdAt)
          break
        case 'updated':
        default:
          sorted.sort((a, b) => b.updatedAt - a.updatedAt)
          break
      }
      return { displayNodes: sorted, similarityMap: new Map<string, number>() }
    }

    const q = searchQuery.trim().toLowerCase()
    const stringMatches = allNodes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.labels.some(l => l.toLowerCase().includes(q)) ||
      Object.values(n.props).some(v =>
        typeof v === 'string' && v.toLowerCase().includes(q)
      )
    )

    const sorted = [...stringMatches]
    switch (sortMode) {
      case 'label':
        sorted.sort((a, b) => a.labels[0]?.localeCompare(b.labels[0] ?? '') ?? 0)
        break
      case 'created':
        sorted.sort((a, b) => b.createdAt - a.createdAt)
        break
      case 'updated':
      default:
        sorted.sort((a, b) => b.updatedAt - a.updatedAt)
        break
    }

    const stringMatchIds = new Set(sorted.map(n => n.id))
    const allNodeMap = new Map(allNodes.map(n => [n.id, n]))
    const vectorOnly: ParsedNode[] = []
    const simMap = new Map<string, number>()

    for (const [id, sim] of vectorHits) {
      if (!stringMatchIds.has(id) && allNodeMap.has(id)) {
        vectorOnly.push(allNodeMap.get(id)!)
        simMap.set(id, sim)
      }
    }

    vectorOnly.sort((a, b) => (simMap.get(b.id) ?? 0) - (simMap.get(a.id) ?? 0))

    return { displayNodes: [...sorted, ...vectorOnly], similarityMap: simMap }
  }, [allNodes, searchQuery, sortMode, vectorHits])

  const handleSortChange = useCallback(() => {
    setSortMode(prev => {
      const next = prev === 'updated' ? 'label' : prev === 'label' ? 'created' : 'updated'
      if (onConfigChange) onConfigChange({ ...config, sortMode: next })
      return next
    })
  }, [config, onConfigChange])

  // ── Explorer context ──────────────────────────────────────────────────
  const ctxValue = useMemo<ExplorerContextValue>(() => ({
    nodeMap,
    edgeCache,
    loadingEdges,
    expandedIds,
    toggleExpand,
    fetchEdgesFor,
    similarityMap,
  }), [nodeMap, edgeCache, loadingEdges, expandedIds, toggleExpand, fetchEdgesFor, similarityMap])

  // Empty state
  if (allNodes.length === 0) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4"
        data-doc='{"icon":"mdi:file-tree","title":"Knowledge Graph","desc":"Explore your knowledge graph — expand nodes to traverse edges and connections."}'
      >
        <GitBranch className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">No graph nodes yet</span>
        <span className="text-xs opacity-50 mt-1">Nodes appear after processing conversations</span>
      </div>
    )
  }

  return (
    <ExplorerCtx.Provider value={ctxValue}>
      <div
        className="w-full h-full flex flex-col overflow-hidden"
        data-doc='{"icon":"mdi:file-tree","title":"Knowledge Graph","desc":"Explore your knowledge graph — expand nodes to traverse edges and connections."}'
      >
        {/* Header */}
        <div className="flex-shrink-0 px-2 py-1.5 border-b border-slate-100 flex items-center gap-1.5">
          <GitBranch size={12} className="text-slate-400 shrink-0" />

          {/* View mode toggle */}
          <div className="flex items-center bg-slate-50/80 rounded p-px shrink-0">
            <button
              onClick={() => viewMode !== 'tree' && handleViewModeToggle()}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                viewMode === 'tree'
                  ? 'bg-white text-slate-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-500'
              }`}
              title="Tree view"
            >
              <List size={9} />
            </button>
            <button
              onClick={() => viewMode !== 'graph' && handleViewModeToggle()}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                viewMode === 'graph'
                  ? 'bg-white text-slate-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-500'
              }`}
              title="Graph view"
            >
              <Network size={9} />
            </button>
          </div>

          {viewMode === 'tree' && (
            <>
              <div className="flex items-center gap-1 flex-1 min-w-0 bg-slate-50/50 rounded px-1.5 py-0.5">
                <Search size={10} className="text-slate-300 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search nodes..."
                  className="text-[10px] text-slate-600 bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-slate-300"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-[9px] text-slate-300 hover:text-slate-500 shrink-0 transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                onClick={handleSortChange}
                className="flex items-center gap-0.5 text-[9px] text-slate-400 hover:text-slate-600 shrink-0 px-1.5 py-0.5 rounded hover:bg-slate-50 transition-colors"
                title={`Sort by: ${sortMode}`}
              >
                <ArrowUpDown size={9} />
                <span className="capitalize">{sortMode}</span>
              </button>
            </>
          )}

          {viewMode === 'graph' && (
            <div className="flex-1" /> /* spacer — graph view has its own search */
          )}
        </div>

        {/* Tree view */}
        {viewMode === 'tree' && (
          <>
            <div className="flex-1 overflow-auto px-0.5 py-1">
              {displayNodes.map(node => (
                <GraphExplorerNode
                  key={node.id}
                  nodeId={node.id}
                  depth={0}
                  ancestorIds={EMPTY_SET}
                  similarity={similarityMap.get(node.id)}
                />
              ))}
            </div>

            <div className="flex-shrink-0 px-2 py-1 text-[9px] text-slate-400 border-t border-slate-100 flex items-center gap-3">
              <span>{displayNodes.length} nodes</span>
              {searchQuery && displayNodes.length !== allNodes.length && (
                <span>of {allNodes.length} total</span>
              )}
              {vectorSearching && (
                <span className="flex items-center gap-0.5 text-violet-400">
                  <Sparkles size={8} className="animate-pulse" /> searching...
                </span>
              )}
              {!vectorSearching && searchQuery.trim().length >= 3 && similarityMap.size > 0 && (
                <span className="flex items-center gap-0.5 text-violet-400">
                  <Sparkles size={8} /> +{similarityMap.size} semantic{vectorMs != null ? ` · ${vectorMs}ms` : ''}
                </span>
              )}
            </div>
          </>
        )}

        {/* Graph view */}
        {viewMode === 'graph' && (
          <GraphNetworkView />
        )}
      </div>
    </ExplorerCtx.Provider>
  )
}
