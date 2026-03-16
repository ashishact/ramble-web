/**
 * useKnowledgeMapData — Knowledge Map React Hook
 *
 * Manages two-tier coverage scoring:
 *   - Base coverage: loaded from cache, recalculated on synthesis:period-done
 *   - Live coverage: reconstructed from DuckDB conversations (current period),
 *     then updated in real-time via sys1:response events
 *
 * Returns merged topic list + current topic for sunburst visualization.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { eventBus } from '../../../lib/eventBus'
import {
  loadCachedCoverage,
  saveCachedCoverage,
  calculateBaseCoverage,
  calculateLiveTopicCoverage,
  mergeCoverage,
  groupSimilarTopics,
  type TopicCoverage,
} from './coverageScorer'

export interface CoverageTimings {
  baseMs: number | null
  liveMs: number | null
  groupMs: number | null
}

interface UseKnowledgeMapDataResult {
  topics: TopicCoverage[]
  currentTopic: string | null
  isLoading: boolean
  recalculate: () => void
  timings: CoverageTimings
}

export function useKnowledgeMapData(isPaused: boolean): UseKnowledgeMapDataResult {
  const [baseCoverage, setBaseCoverage] = useState<TopicCoverage[]>([])
  const [liveCoverage, setLiveCoverage] = useState<TopicCoverage[]>([])
  const [currentTopic, setCurrentTopic] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [timings, setTimings] = useState<CoverageTimings>({ baseMs: null, liveMs: null, groupMs: null })

  // Track unique live topics to avoid redundant vector searches
  const seenLiveTopicsRef = useRef(new Set<string>())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTopicsRef = useRef<string[]>([])

  // ── Load cached base coverage on mount ─────────────────────────────

  useEffect(() => {
    const cached = loadCachedCoverage()
    if (cached && cached.topics.length > 0) {
      setBaseCoverage(cached.topics)
      setTimings(t => ({ ...t, baseMs: 0 })) // from cache
      setIsLoading(false)
    } else {
      const t0 = performance.now()
      calculateBaseCoverage()
        .then(topics => {
          setTimings(t => ({ ...t, baseMs: Math.round(performance.now() - t0) }))
          setBaseCoverage(topics)
          saveCachedCoverage({
            lastPeriodKey: '',
            calculatedAt: Date.now(),
            topics,
          })
        })
        .catch(err => console.warn('[KnowledgeMap] Base coverage failed:', err))
        .finally(() => setIsLoading(false))
    }
  }, [])

  // ── Reconstruct live coverage from DuckDB on mount ────────────────
  // Query conversations from the current period to get unique SYS-I topics,
  // then score each one. This survives page reloads since DuckDB is persistent.

  useEffect(() => {
    let cancelled = false

    async function reconstructFromDB() {
      const t0 = performance.now()
      const { conversationStore } = await import('../../../graph/stores/conversationStore')
      const { periodMs, dateStr, currentSlot } = await import('../../../modules/synthesis/periodUtils')

      // Get the start of the current 6-hour period
      const { startMs } = periodMs(dateStr(), currentSlot())
      const topics = await conversationStore.getUniqueTopicsSince(startMs)

      if (topics.length === 0 || cancelled) {
        setTimings(t => ({ ...t, liveMs: Math.round(performance.now() - t0) }))
        return
      }

      // Mark as already seen so real-time subscription doesn't re-score them
      for (const t of topics) {
        seenLiveTopicsRef.current.add(t)
      }

      // Set current topic to the last one
      setCurrentTopic(topics[topics.length - 1])

      // Score each unique topic
      const results: TopicCoverage[] = []
      for (const topicName of topics) {
        if (cancelled) return
        try {
          const coverage = await calculateLiveTopicCoverage(topicName)
          results.push(coverage)
        } catch (err) {
          console.warn('[KnowledgeMap] Reconstruct topic failed:', topicName, err)
        }
      }

      if (!cancelled && results.length > 0) {
        setLiveCoverage(results)
      }
      setTimings(t => ({ ...t, liveMs: Math.round(performance.now() - t0) }))
    }

    reconstructFromDB()

    return () => { cancelled = true }
  }, [])

  // ── Recalculate base coverage ──────────────────────────────────────

  const recalculate = useCallback(() => {
    setIsLoading(true)
    setTimings({ baseMs: null, liveMs: null, groupMs: null })
    const t0 = performance.now()
    calculateBaseCoverage()
      .then(topics => {
        setTimings(t => ({ ...t, baseMs: Math.round(performance.now() - t0) }))
        setBaseCoverage(topics)
        saveCachedCoverage({
          lastPeriodKey: '',
          calculatedAt: Date.now(),
          topics,
        })
      })
      .catch(err => console.warn('[KnowledgeMap] Recalculate failed:', err))
      .finally(() => setIsLoading(false))
  }, [])

  // ── Subscribe to synthesis:period-done → recalculate base ──────────

  useEffect(() => {
    if (isPaused) return

    const unsub = eventBus.on('synthesis:period-done', (payload) => {
      calculateBaseCoverage()
        .then(topics => {
          setBaseCoverage(topics)
          saveCachedCoverage({
            lastPeriodKey: payload.periodKey,
            calculatedAt: Date.now(),
            topics,
          })
        })
        .catch(err => console.warn('[KnowledgeMap] Post-period coverage failed:', err))
    })

    return unsub
  }, [isPaused])

  // ── Subscribe to sys1:response → live topic scoring ────────────────

  useEffect(() => {
    if (isPaused) return

    const unsub = eventBus.on('sys1:response', (payload) => {
      if (!payload.topic) return

      setCurrentTopic(payload.topic)

      // Skip if already scored (from DB reconstruction or earlier event)
      if (seenLiveTopicsRef.current.has(payload.topic)) return

      // Debounce: collect topics, batch-score after 2s
      pendingTopicsRef.current.push(payload.topic)
      seenLiveTopicsRef.current.add(payload.topic)

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(async () => {
        const topics = [...pendingTopicsRef.current]
        pendingTopicsRef.current = []

        const results: TopicCoverage[] = []
        for (const topicName of topics) {
          try {
            const coverage = await calculateLiveTopicCoverage(topicName)
            results.push(coverage)
          } catch (err) {
            console.warn('[KnowledgeMap] Live topic scoring failed:', topicName, err)
          }
        }

        if (results.length > 0) {
          setLiveCoverage(prev => [...prev, ...results])
        }
      }, 2000)
    })

    return () => {
      unsub()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [isPaused])

  // ── Merge base + live, then group similar topics ─────────────────

  const merged = useMemo(
    () => mergeCoverage(baseCoverage, liveCoverage),
    [baseCoverage, liveCoverage],
  )

  const [topics, setTopics] = useState<TopicCoverage[]>([])

  useEffect(() => {
    if (merged.length === 0) { setTopics([]); return }

    // Show ungrouped immediately so the map is never blank
    setTopics(merged)

    // Then upgrade to grouped once embeddings resolve
    let cancelled = false
    const t0 = performance.now()
    groupSimilarTopics(merged).then(grouped => {
      if (!cancelled) {
        setTimings(t => ({ ...t, groupMs: Math.round(performance.now() - t0) }))
        setTopics(grouped)
      }
    }).catch(() => {
      // Already showing merged — nothing to do
    })
    return () => { cancelled = true }
  }, [merged])

  return { topics, currentTopic, isLoading, recalculate, timings }
}
