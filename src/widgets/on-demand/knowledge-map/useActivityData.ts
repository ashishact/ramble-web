/**
 * useActivityData — Activity Heatmap React Hook
 *
 * Determines which two months to display:
 *   - First half of month (days 1–15): previous month + current month
 *   - Second half (days 16+): current month + next month
 *
 * Queries DuckDB for daily conversation counts covering those two months.
 * Re-queries when the conversations table changes via graphEventBus.
 * Provides on-click stats fetching with an in-memory cache.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { graphEventBus } from '../../../graph/events'

export interface DailyCount {
  day: string
  count: number
}

export interface DayStats {
  conversations: number
  entities: number
  goals: number
  memories: number
  topics: number
}

export interface MonthInfo {
  year: number
  month: number           // 0-indexed
  label: string           // e.g. "March 2026"
  startDate: Date         // 1st of month, midnight
  daysInMonth: number
}

interface UseActivityDataResult {
  dailyCounts: DailyCount[]
  isLoading: boolean
  months: [MonthInfo, MonthInfo]
  getDayStats: (day: string) => DayStats | null
}

function buildMonthInfo(year: number, month: number): MonthInfo {
  const startDate = new Date(year, month, 1)
  startDate.setHours(0, 0, 0, 0)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const label = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return { year, month, label, startDate, daysInMonth }
}

export function useActivityData(): UseActivityDataResult {
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const statsCache = useRef(new Map<string, DayStats>())
  const inflight = useRef(new Set<string>())

  // Compute which two months to show
  const months = useMemo((): [MonthInfo, MonthInfo] => {
    const today = new Date()
    const y = today.getFullYear()
    const m = today.getMonth()
    const day = today.getDate()
    const daysInCurrentMonth = new Date(y, m + 1, 0).getDate()

    if (day <= Math.floor(daysInCurrentMonth / 2)) {
      // First half → previous month + current month
      const prevMonth = m === 0 ? 11 : m - 1
      const prevYear = m === 0 ? y - 1 : y
      return [buildMonthInfo(prevYear, prevMonth), buildMonthInfo(y, m)]
    } else {
      // Second half → current month + next month
      const nextMonth = m === 11 ? 0 : m + 1
      const nextYear = m === 11 ? y + 1 : y
      return [buildMonthInfo(y, m), buildMonthInfo(nextYear, nextMonth)]
    }
  }, [])

  // Query from the start of the first month
  const sinceMs = months[0].startDate.getTime()

  const fetchCounts = useCallback(async () => {
    try {
      const { conversationStore } = await import('../../../graph/stores/conversationStore')
      const counts = await conversationStore.getDailyCounts(sinceMs)
      setDailyCounts(counts)
    } catch (err) {
      console.warn('[ActivityHeatmap] Failed to fetch daily counts:', err)
    } finally {
      setIsLoading(false)
    }
  }, [sinceMs])

  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  useEffect(() => {
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.includes('conversations') || tables.includes('nodes')) {
        statsCache.current.clear()
        inflight.current.clear()
        fetchCounts()
      }
    })
    return unsub
  }, [fetchCounts])

  const getDayStats = useCallback((day: string): DayStats | null => {
    const cached = statsCache.current.get(day)
    if (cached) return cached

    if (inflight.current.has(day)) return null
    inflight.current.add(day)

    import('../../../graph/stores/conversationStore')
      .then(({ conversationStore }) => conversationStore.getDayStats(day))
      .then(stats => {
        statsCache.current.set(day, stats)
      })
      .catch(err => {
        console.warn('[ActivityHeatmap] Day stats fetch failed:', day, err)
      })
      .finally(() => {
        inflight.current.delete(day)
      })

    return null
  }, [])

  return { dailyCounts, isLoading, months, getDayStats }
}
