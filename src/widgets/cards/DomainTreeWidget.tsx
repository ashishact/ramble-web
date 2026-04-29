/**
 * DomainTreeWidget
 *
 * Single-level drill-down donut for the user's domain tree.
 * - Top level: one ring showing all top-level domains
 * - Click a segment → drill in to see its children (ECharts animates the transition)
 * - Header "Back" button returns to top level
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { WidgetProps } from '../types';
import { storeGet } from '../../services/rambleApi';
import { GitBranch, RefreshCw, Loader2, ChevronLeft } from 'lucide-react';
import { parseDomainTreeJsonl } from './DomainTreeSunburst';
import type { DomainNode } from './DomainTreeSunburst';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function nodeDepth(id: string) { return id.split('.').length - 1 }
function nodeParentId(id: string): string | null {
  const parts = id.split('.')
  return parts.length === 1 ? null : parts.slice(0, -1).join('.')
}

// ── Data builders ─────────────────────────────────────────────────────────────

interface RingItem {
  name: string
  value: number
  nodeId: string
  hasChildren: boolean
  childLabels: string[]
  description?: string
}

function buildTopLevelItems(nodes: DomainNode[]): RingItem[] {
  return nodes
    .filter(n => nodeDepth(n.id) === 0)
    .map(n => {
      const children = nodes.filter(c => nodeParentId(c.id) === n.id)
      return {
        name: n.label,
        value: Math.max(1, n.weight ?? 1),
        nodeId: n.id,
        hasChildren: children.length > 0,
        childLabels: children.map(c => c.label),
        description: n.description,
      }
    })
}

function buildChildItems(nodes: DomainNode[], parentId: string): RingItem[] {
  return nodes
    .filter(n => nodeParentId(n.id) === parentId)
    .map(n => ({
      name: n.label,
      value: Math.max(1, n.weight ?? 1),
      nodeId: n.id,
      hasChildren: false,
      childLabels: [],
      description: n.description,
    }))
}

// ── DonutChart ────────────────────────────────────────────────────────────────

interface DonutChartProps {
  items: RingItem[]
  centerLabel: string
  onSegmentClick: (item: RingItem) => void
  onSegmentHover: (item: RingItem | null) => void
  onCenterClick?: () => void
}

const DonutChart: React.FC<DonutChartProps> = ({ items, centerLabel, onSegmentClick, onSegmentHover, onCenterClick }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import('echarts')['init']> | null>(null)
  const [ready, setReady] = useState(false)
  const onClickRef = useRef(onSegmentClick)
  onClickRef.current = onSegmentClick
  const onHoverRef = useRef(onSegmentHover)
  onHoverRef.current = onSegmentHover
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    let disposed = false
    import('echarts').then(echarts => {
      if (disposed || !containerRef.current) return
      const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' })
      chartRef.current = chart
      chart.on('click', (params: { name: string }) => {
        const item = itemsRef.current.find(it => it.name === params.name)
        if (item) onClickRef.current(item)
      })
      chart.on('mouseover', (params: { name: string }) => {
        const item = itemsRef.current.find(it => it.name === params.name)
        onHoverRef.current(item ?? null)
      })
      chart.on('mouseout', () => {
        onHoverRef.current(null)
      })
      setReady(true)
    }).catch(err => console.warn('[DomainTree] ECharts init failed:', err))
    return () => {
      disposed = true
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready || !chartRef.current) return
    chartRef.current.setOption({
      animation: true,
      animationDuration: 500,
      animationEasing: 'cubicInOut',
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        textStyle: { color: '#1e293b', fontSize: 12 },
        shadowBlur: 12,
        shadowColor: 'rgba(0,0,0,0.08)',
        formatter: (params: { name: string; percent: number; data: RingItem }) => {
          const children = params.data.childLabels ?? []
          const childrenHtml = children.length > 0
            ? children.map(c => `<div style="color:#64748b;font-size:11px;margin-top:2px">· ${c}</div>`).join('')
            : ''
          const hint = children.length > 0
            ? ' <span style="color:#94a3b8;font-size:10px">tap to explore</span>'
            : ''
          return `<div style="white-space:normal"><span style="font-weight:600">${params.name}</span>${hint}${childrenHtml}</div>`
        },
      },
      graphic: [{
        type: 'text',
        left: 'center',
        top: 'middle',
        style: {
          text: centerLabel,
          textAlign: 'center',
          fill: '#94a3b8',
          fontSize: Math.max(10, Math.min(16, Math.round(160 / Math.max(10, centerLabel.length)))),
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
      }],
      series: [{
        type: 'pie',
        radius: ['32%', '62%'],
        center: ['50%', '50%'],
        padAngle: 3,
        avoidLabelOverlap: true,
        itemStyle: {
          borderColor: '#ffffff',
          borderWidth: 3,
          borderRadius: 10,
        },
        label: {
          show: true,
          position: 'outside',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          formatter: (params: { name: string; data: RingItem }) => {
            const count = params.data.childLabels?.length ?? 0
            if (count > 0) return `{name|${params.name} ›}\n{count|${count} inside}`
            return `{name|${params.name}}`
          },
          rich: {
            name: { fontSize: 11, fontWeight: 500, color: '#475569', lineHeight: 16 },
            count: { fontSize: 9, color: '#94a3b8', lineHeight: 14 },
          },
        },
        labelLine: {
          length: 16,
          length2: 8,
          lineStyle: { color: '#cbd5e1', width: 1 },
        },
        emphasis: {
          scale: true,
          scaleSize: 10,
          itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.18)' },
        },
        data: items.map(item => ({
          name: item.name,
          value: item.value,
          hasChildren: item.hasChildren,
          childLabels: item.childLabels,
          description: item.description,
        })),
      }],
    })
  }, [ready, items, centerLabel])

  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [ready])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {/* Transparent center tap zone — no icon, pointer cursor only.
          pointer-events-none on wrapper keeps segment clicks working. */}
      {onCenterClick && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            onClick={onCenterClick}
            className="pointer-events-auto w-16 h-16 rounded-full cursor-pointer"
          />
        </div>
      )}
    </div>
  )
}

// ── Widget ────────────────────────────────────────────────────────────────────

const DOC_ATTR = '{"icon":"mdi:sitemap","title":"Domain Tree","desc":"Your areas of life as a donut chart. Click a segment to explore sub-domains."}'

export const DomainTreeWidget: React.FC<WidgetProps> = () => {
  const [nodes, setNodes] = useState<DomainNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unauthenticated, setUnauthenticated] = useState(false)
  const [drillTarget, setDrillTarget] = useState<string | null>(null)
  const [hoveredItem, setHoveredItem] = useState<RingItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setUnauthenticated(false)
    try {
      const res = await storeGet('ramble', 'views/domain-tree')
      if (res.status === 401 || res.status === 403) { setUnauthenticated(true); return }
      if (!res.ok) {
        if (res.status === 404) { setNodes([]); return }
        setError(`Failed to load: ${res.status}`); return
      }
      setNodes(parseDomainTreeJsonl(await res.text()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const { items, centerLabel, drillLabel } = useMemo(() => {
    if (!drillTarget) {
      return {
        items: buildTopLevelItems(nodes),
        centerLabel: '',
        drillLabel: null,
      }
    }
    const parent = nodes.find(n => n.id === drillTarget)
    return {
      items: buildChildItems(nodes, drillTarget),
      centerLabel: parent?.label ?? '',
      drillLabel: parent?.label ?? '',
    }
  }, [nodes, drillTarget])

  const handleSegmentClick = useCallback((item: RingItem) => {
    if (item.hasChildren) setDrillTarget(item.nodeId)
  }, [])

  const handleSegmentHover = useCallback((item: RingItem | null) => {
    setHoveredItem(item)
  }, [])

  if (loading) return (
    <div className="w-full h-full flex items-center justify-center gap-2 text-slate-400" data-doc={DOC_ATTR}>
      <Loader2 size={14} className="animate-spin" />
      <span className="text-xs">Loading…</span>
    </div>
  )

  if (unauthenticated) return (
    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4" data-doc={DOC_ATTR}>
      <GitBranch className="w-8 h-8 mb-2 opacity-40" />
      <span className="text-sm">Sign in to view</span>
    </div>
  )

  if (error) return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 p-4" data-doc={DOC_ATTR}>
      <GitBranch className="w-7 h-7 opacity-40" />
      <p className="text-xs text-red-400">{error}</p>
      <button onClick={load} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 transition-colors">
        <RefreshCw size={10} /> Retry
      </button>
    </div>
  )

  if (nodes.length === 0) return (
    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4" data-doc={DOC_ATTR}>
      <GitBranch className="w-8 h-8 mb-2 opacity-40" />
      <span className="text-sm">No domain tree yet</span>
      <span className="text-xs opacity-50 mt-1 text-center">Run build-domain-tree-ramble</span>
    </div>
  )

  return (
    <div className="w-full h-full flex flex-col overflow-hidden" data-doc={DOC_ATTR}>
      {/* Header */}
      <div className="flex-shrink-0 px-2.5 py-1.5 border-b border-slate-100 flex items-center gap-1.5">
        {drillLabel ? (
          <button
            onClick={() => setDrillTarget(null)}
            className="flex items-center gap-0.5 text-[9px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            <ChevronLeft size={11} />
            <span>Back</span>
          </button>
        ) : (
          <GitBranch size={11} className="text-slate-400 shrink-0" />
        )}
        <span className="text-[10px] font-semibold text-slate-500 flex-1">
          {drillLabel ?? 'Domain Tree'}
        </span>
        <span className="text-[9px] text-slate-300 tabular-nums">{items.length}</span>
        <button onClick={load} className="p-0.5 rounded hover:bg-slate-100 transition-colors" title="Refresh">
          <RefreshCw size={11} className="text-slate-400" />
        </button>
      </div>

      {/* Hover description — one-line subtitle that fades in on segment hover */}
      <div className="flex-shrink-0 h-5 px-3 flex items-center justify-center overflow-hidden">
        <span className={`text-[11px] text-slate-500 italic truncate transition-opacity duration-150 ${hoveredItem?.description ? 'opacity-100' : 'opacity-0'}`}>
          {hoveredItem?.description ?? '\u00a0'}
        </span>
      </div>

      {/* Chart — single persistent instance, data changes animate in-place */}
      <div className="flex-1 min-h-0">
        <DonutChart
          items={items}
          centerLabel={centerLabel}
          onSegmentClick={handleSegmentClick}
          onSegmentHover={handleSegmentHover}
          onCenterClick={drillTarget ? () => setDrillTarget(null) : undefined}
        />
      </div>
    </div>
  )
}
