/**
 * SunburstChart — ECharts Sunburst Wrapper
 *
 * Dynamically imports echarts for code splitting.
 * Handles resize via ResizeObserver, disposes on unmount.
 * Font sizes scale with container size (min dimension).
 */

import { useRef, useEffect, useState } from 'react'
import type { SunburstNode } from './sunburstData'

interface SunburstChartProps {
  data: SunburstNode
  currentTopic: string | null
}

/** Clamp a value between min and max */
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function SunburstChart({ data, currentTopic }: SunburstChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import('echarts')['init']> | null>(null)
  const [ready, setReady] = useState(false)
  const [minDim, setMinDim] = useState(400)

  // ── Initialize ECharts ─────────────────────────────────────────────

  useEffect(() => {
    let disposed = false

    async function init() {
      const echarts = await import('echarts')

      if (disposed || !containerRef.current) return

      const chart = echarts.init(containerRef.current, undefined, {
        renderer: 'canvas',
      })
      chartRef.current = chart
      setReady(true)
    }

    init().catch(err => console.warn('[KnowledgeMap] ECharts init failed:', err))

    return () => {
      disposed = true
      if (chartRef.current) {
        chartRef.current.dispose()
        chartRef.current = null
      }
    }
  }, [])

  // ── Update chart data ──────────────────────────────────────────────

  useEffect(() => {
    if (!ready || !chartRef.current) return
    const chart = chartRef.current

    // ── Capture drill-down state before replacing data ────────────
    let drillTarget: string | null = null
    let drillDepth = 0
    try {
      const seriesModel = (chart as any).getModel()?.getSeriesByIndex(0)
      const viewRoot = seriesModel?.getViewRoot?.()
      if (viewRoot && viewRoot.depth > 0) {
        drillTarget = viewRoot.name
        drillDepth = viewRoot.depth
      }
    } catch { /* first render or internal API unavailable */ }

    // Derive sizes from container's min dimension
    const scale = clamp(minDim / 400, 0.55, 1.3)
    const baseFontSize = clamp(Math.round(11 * scale), 7, 13)
    const domainFontSize = clamp(Math.round(11 * scale), 7, 13)
    const topicFontSize = clamp(Math.round(12 * scale), 8, 14)

    // Compute label width so that ring + label fits within the container radius.
    // Outer ring edge sits at OUTER_RING_PCT % of the available radius.
    const OUTER_RING_PCT = 40
    const containerRadius = minDim / 2
    const outerRingPx = containerRadius * OUTER_RING_PCT / 100
    const labelSpace = containerRadius - outerRingPx - 6 // 6px buffer
    const topicDistance = clamp(Math.round(labelSpace * 0.08), 2, 10)

    chart.setOption({
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(30, 30, 40, 0.9)',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (params: { name: string; data?: SunburstNode }) => {
          const d = params.data?.topicData
          if (!d) return `<strong>${params.name}</strong>`
          const pct = Math.round(d.score * 100)
          const bar = '█'.repeat(Math.round(d.score * 10)) + '░'.repeat(10 - Math.round(d.score * 10))
          return [
            `<strong>${params.name}</strong>`,
            `<span style="font-family:monospace;letter-spacing:1px">${bar}</span> ${pct}%`,
            `${d.mentionCount} mention${d.mentionCount !== 1 ? 's' : ''} · ${d.matchCount} related nodes`,
            d.isLive ? '<em style="color:#6ee7b7">● Active this session</em>' : '',
          ].filter(Boolean).join('<br/>')
        },
      },
      series: [{
        type: 'sunburst',
        data: data.children || [],
        center: ['50%', '50%'],
        sort: (a: { depth: number; getValue: () => number; dataIndex: number }, b: { depth: number; getValue: () => number; dataIndex: number }) => {
          if (a.depth === 1) return b.getValue() - a.getValue()
          return a.dataIndex - b.dataIndex
        },
        emphasis: {
          focus: 'ancestor',
        },
        label: {
          rotate: 'radial',
          color: '#1e293b',
          fontSize: baseFontSize,
          overflow: 'truncate',
        },
        itemStyle: {
          borderColor: '#f8fafc',
          borderWidth: 2,
          borderRadius: 3,
        },
        levels: [
          {},
          // Domain ring (inner)
          {
            r0: '8%',
            r: '24%',
            label: {
              rotate: 0,
              fontSize: domainFontSize,
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: '#334155',
            },
          },
          // Topic ring (outer) — compact ring, labels extend outward
          {
            r0: '26%',
            r: '40%',
            label: {
              position: 'outside',
              distance: topicDistance,
              rotate: 'radial',
              fontSize: topicFontSize,
              fontWeight: 500,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: '#475569',
              padding: 4,
            },
            downplay: {
              label: { opacity: 0.5 },
            },
          },
        ],
      }],
    }, true)

    // ── Restore drill-down state ──────────────────────────────────
    if (drillTarget) {
      try {
        const seriesModel = (chart as any).getModel()?.getSeriesByIndex(0)
        const treeRoot = seriesModel?.getData()?.tree?.root
        let target = null
        if (drillDepth === 1) {
          target = treeRoot?.children?.find((n: any) => n.name === drillTarget)
        } else if (drillDepth >= 2) {
          for (const domain of treeRoot?.children || []) {
            const found = domain.children?.find((n: any) => n.name === drillTarget)
            if (found) { target = found; break }
          }
        }
        if (target) {
          chart.dispatchAction({ type: 'sunburstRootToNode', targetNode: target })
        }
      } catch { /* domain/topic removed from data, stay at root */ }
    }
  }, [ready, data, currentTopic, minDim])

  // ── ResizeObserver ─────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || !chartRef.current) return

    const ro = new ResizeObserver((entries) => {
      chartRef.current?.resize()
      const entry = entries[0]
      if (entry) {
        setMinDim(Math.max(200, Math.min(entry.contentRect.width, entry.contentRect.height)))
      }
    })
    ro.observe(containerRef.current)

    return () => ro.disconnect()
  }, [ready])

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[200px]"
    />
  )
}
