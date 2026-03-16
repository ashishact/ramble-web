/**
 * ActivityHeatmap — Two-Month Calendar Grid
 *
 * Shows two full calendar months (1st → end) side by side or stacked.
 * Which months: first half of current month → prev + current,
 * second half → current + next. Click a day for stats.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { MessageSquare, Lightbulb, Target, Brain, BookOpen } from 'lucide-react'
import type { DailyCount, DayStats, MonthInfo } from './useActivityData'

interface ActivityHeatmapProps {
  dailyCounts: DailyCount[]
  months: [MonthInfo, MonthInfo]
  getDayStats: (day: string) => DayStats | null
}

// Neutral grey for empty, vibrant emeralds for active
const LEVEL_COLORS = ['#e2e8f0', '#6ee7b7', '#34d399', '#10b981', '#047857']

function dateNumColor(level: number): string {
  if (level === 0) return 'rgba(100,116,139,0.4)'
  if (level <= 1) return 'rgba(0,0,0,0.3)'
  return 'rgba(255,255,255,0.75)'
}

function getLevel(count: number, max: number): number {
  if (count === 0) return 0
  if (max <= 0) return 1
  const ratio = count / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const GAP = 2
const PAD_X = 12
const MAX_CELL = 40
const MIN_CELL = 12
const MONTH_HEADER_H = 18
const DOW_HEADER_H = 14
const STATS_PANEL_H = 80

type Cell = { date: Date; key: string; count: number; dayOfMonth: number }

/** Build a full calendar month grid: rows = weeks, cols = Mon–Sun */
function buildMonthGrid(
  info: MonthInfo,
  countMap: Map<string, number>,
): Array<Array<Cell | null>> {
  const weeks: Array<Array<Cell | null>> = []
  let week: Array<Cell | null> = new Array(7).fill(null)

  for (let day = 1; day <= info.daysInMonth; day++) {
    const d = new Date(info.year, info.month, day)
    const dow = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
    const key = isoDate(d)
    week[dow] = { date: d, key, count: countMap.get(key) ?? 0, dayOfMonth: day }

    // End of week row (Sunday) or last day of month → push row
    if (dow === 6 || day === info.daysInMonth) {
      weeks.push(week)
      week = new Array(7).fill(null)
    }
  }

  return weeks
}

export function ActivityHeatmap({ dailyCounts, months, getDayStats }: ActivityHeatmapProps) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [detailTick, setDetailTick] = useState(0)
  const [cellSize, setCellSize] = useState(16)
  const containerRef = useRef<HTMLDivElement>(null)

  const countMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const { day, count } of dailyCounts) m.set(day.slice(0, 10), count)
    return m
  }, [dailyCounts])

  const maxCount = useMemo(
    () => dailyCounts.reduce((mx, d) => (d.count > mx ? d.count : mx), 0),
    [dailyCounts],
  )

  const month1Grid = useMemo(() => buildMonthGrid(months[0], countMap), [months, countMap])
  const month2Grid = useMemo(() => buildMonthGrid(months[1], countMap), [months, countMap])
  const maxRows = Math.max(month1Grid.length, month2Grid.length)
  const totalRows = month1Grid.length + month2Grid.length

  // Track orientation for cell size computation
  const [isLandscape, setIsLandscape] = useState(true)

  // ── Responsive cell size ───────────────────────────────────────────

  const computeCellSize = useCallback(() => {
    if (!containerRef.current) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    const landscape = width >= height

    setIsLandscape(landscape)

    if (landscape) {
      // Side by side: 14 columns + gap between months
      const monthGap = 16
      const fromW = Math.floor((width - PAD_X * 2 - monthGap - 12 * GAP) / 14)
      const fixedH = MONTH_HEADER_H + DOW_HEADER_H + 20 + STATS_PANEL_H + 16
      const fromH = Math.floor((height - fixedH - (maxRows - 1) * GAP) / maxRows)
      setCellSize(Math.max(MIN_CELL, Math.min(MAX_CELL, fromW, fromH)))
    } else {
      // Stacked: 7 columns, double the rows
      const fromW = Math.floor((width - PAD_X * 2 - 6 * GAP) / 7)
      const fixedH = (MONTH_HEADER_H + DOW_HEADER_H) * 2 + 20 + STATS_PANEL_H + 24
      const fromH = Math.floor((height - fixedH - (totalRows - 1) * GAP) / totalRows)
      setCellSize(Math.max(MIN_CELL, Math.min(MAX_CELL, fromW, fromH)))
    }
  }, [maxRows, totalRows])

  useEffect(() => {
    computeCellSize()
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => computeCellSize())
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [computeCellSize])

  // ── Selection ──────────────────────────────────────────────────────

  function handleClick(dayKey: string) {
    setSelectedDay(prev => (prev === dayKey ? null : dayKey))
    if (!getDayStats(dayKey)) {
      setTimeout(() => setDetailTick(t => t + 1), 300)
    }
  }

  const selectedData = useMemo(() => {
    void detailTick
    if (!selectedDay) return null
    const count = countMap.get(selectedDay) ?? 0
    const stats = getDayStats(selectedDay)
    const d = new Date(selectedDay + 'T12:00:00')
    return { label: formatDayLabel(d), count, stats }
  }, [selectedDay, countMap, getDayStats, detailTick])

  // ── Sizes + today ───────────────────────────────────────────────────

  const todayKey = useMemo(() => isoDate(new Date()), [])
  const dateFontSize = Math.max(7, Math.min(12, Math.round(cellSize * 0.38)))
  const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const dowFontSize = Math.max(8, Math.min(10, Math.round(cellSize * 0.28)))

  // ── Render a month section ─────────────────────────────────────────

  function renderMonth(info: MonthInfo, grid: Array<Array<Cell | null>>) {
    return (
      <div>
        {/* Month name */}
        <div
          className="text-slate-600 font-semibold px-0.5"
          style={{ height: MONTH_HEADER_H, fontSize: Math.min(12, cellSize * 0.35), lineHeight: `${MONTH_HEADER_H}px` }}
        >
          {info.label}
        </div>

        {/* Day-of-week header */}
        <div className="flex" style={{ gap: GAP, marginBottom: GAP }}>
          {DOW.map((d, i) => (
            <div
              key={i}
              className="text-slate-400 text-center font-medium"
              style={{ width: cellSize, height: DOW_HEADER_H, fontSize: dowFontSize }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Week rows */}
        <div className="flex flex-col" style={{ gap: GAP }}>
          {grid.map((week, ri) => (
            <div key={ri} className="flex" style={{ gap: GAP }}>
              {week.map((cell, ci) => {
                if (!cell) {
                  return <div key={ci} style={{ width: cellSize, height: cellSize }} />
                }
                const level = getLevel(cell.count, maxCount)
                const isSelected = selectedDay === cell.key
                const isToday = cell.key === todayKey
                return (
                  <div
                    key={ci}
                    onClick={() => handleClick(cell.key)}
                    className={`relative cursor-pointer transition-all duration-150 hover:ring-1 hover:ring-slate-400/40 ${
                      isSelected ? 'ring-2 ring-emerald-500' : ''
                    }`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: LEVEL_COLORS[level],
                      borderRadius: Math.max(2, cellSize * 0.14),
                    }}
                  >
                    {/* Today indicator dot */}
                    {isToday && (
                      <span
                        className="absolute pointer-events-none"
                        style={{
                          top: 3,
                          right: 3,
                          width: Math.max(5, cellSize * 0.2),
                          height: Math.max(5, cellSize * 0.2),
                          borderRadius: '50%',
                          backgroundColor: '#c2956b',
                        }}
                      />
                    )}
                    <span
                      className="absolute inset-0 flex items-center justify-center select-none pointer-events-none"
                      style={{
                        fontSize: dateFontSize,
                        color: dateNumColor(level),
                        fontWeight: 500,
                        lineHeight: 1,
                      }}
                    >
                      {cell.dayOfMonth}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col overflow-hidden">
      {/* ── Calendar ────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1.5">
        <div className={`flex justify-center ${isLandscape ? 'flex-row gap-4' : 'flex-col gap-2 items-center'}`}>
          {renderMonth(months[0], month1Grid)}
          {renderMonth(months[1], month2Grid)}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-1 pt-0.5">
          <span className="text-[8px] text-slate-400">Less</span>
          {LEVEL_COLORS.map((c, i) => (
            <div key={i} style={{ width: 10, height: 10, backgroundColor: c, borderRadius: 2 }} />
          ))}
          <span className="text-[8px] text-slate-400">More</span>
        </div>
      </div>

      {/* ── Stats panel ─────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 border-t border-slate-100 overflow-y-auto">
        {!selectedData ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-[10px] text-slate-300">Click a day to see stats</span>
          </div>
        ) : (
          <div className="px-3 py-2">
            <div className="text-[11px] font-medium text-slate-600 mb-2">
              {selectedData.label}
            </div>

            {selectedData.stats ? (
              <div className="grid grid-cols-3 gap-1.5">
                <StatPill icon={<MessageSquare size={10} />} value={selectedData.stats.conversations} label="Conversations" color="text-blue-500" />
                <StatPill icon={<Lightbulb size={10} />} value={selectedData.stats.entities} label="Entities" color="text-amber-500" />
                <StatPill icon={<Target size={10} />} value={selectedData.stats.goals} label="Goals" color="text-rose-500" />
                <StatPill icon={<Brain size={10} />} value={selectedData.stats.memories} label="Memories" color="text-purple-500" />
                <StatPill icon={<BookOpen size={10} />} value={selectedData.stats.topics} label="Topics" color="text-emerald-500" />
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
                <span className="text-[10px] text-slate-400">Loading...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatPill({ icon, value, label, color }: {
  icon: React.ReactNode; value: number; label: string; color: string
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-slate-50/80 rounded">
      <span className={`${color} shrink-0`}>{icon}</span>
      <span className="text-[11px] font-semibold text-slate-700 tabular-nums">{value}</span>
      <span className="text-[8px] text-slate-400 truncate">{label}</span>
    </div>
  )
}
