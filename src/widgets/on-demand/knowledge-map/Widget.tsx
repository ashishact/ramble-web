/**
 * KnowledgeMapWidget — Coverage Sunburst + Activity Heatmap
 *
 * Two tabs:
 *   - Coverage: sunburst chart of topic coverage depth
 *   - Activity: GitHub-style calendar heatmap of daily conversation counts
 */

import { useState, useMemo, useCallback } from 'react'
import { Map, RefreshCw, Loader2, Compass, CalendarDays } from 'lucide-react'
import { useWidgetPause } from '../useWidgetPause'
import { useKnowledgeMapData } from './useKnowledgeMapData'
import { buildSunburstData } from './sunburstData'
import { SunburstChart } from './SunburstChart'
import { useActivityData } from './useActivityData'
import { ActivityHeatmap } from './ActivityHeatmap'

type Tab = 'coverage' | 'activity'
type TimeFilter = 'all' | 'today' | 'period'

function getStartOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function KnowledgeMapWidget({ nodeId }: { nodeId: string }) {
  const [tab, setTab] = useState<Tab>('coverage')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const { isPaused, PauseButton, PauseOverlay } = useWidgetPause(nodeId, 'Knowledge Map')
  const { topics, currentTopic, isLoading, recalculate, timings } = useKnowledgeMapData(isPaused)
  const { dailyCounts, isLoading: activityLoading, getDayStats, months } = useActivityData()

  const filteredTopics = useMemo(() => {
    if (timeFilter === 'all') return topics
    if (timeFilter === 'today') {
      const todayStart = getStartOfToday()
      return topics.filter(t => t.lastSeen >= todayStart)
    }
    // 'period' — only live topics from the current period
    return topics.filter(t => t.isLive)
  }, [topics, timeFilter])

  const sunburstData = useMemo(
    () => buildSunburstData(filteredTopics, currentTopic),
    [filteredTopics, currentTopic],
  )

  const cycleTimeFilter = useCallback(() => {
    setTimeFilter(f => f === 'all' ? 'today' : f === 'today' ? 'period' : 'all')
  }, [])

  // ── Empty state (coverage tab only) ──────────────────────────────

  if (tab === 'coverage' && !isLoading && topics.length === 0) {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center p-6"
        data-doc='{"icon":"mdi:map","title":"Knowledge Map","desc":"Sunburst visualization of topic coverage depth. Start speaking to build your knowledge map."}'
      >
        <PauseOverlay />
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center mb-3">
          <Compass className="w-5 h-5 text-emerald-400" />
        </div>
        <span className="text-[12px] font-semibold text-slate-500">
          {isPaused ? 'Paused' : 'No topics yet'}
        </span>
        <span className="text-[10px] text-slate-400 mt-1 max-w-[200px] text-center leading-relaxed">
          {isPaused ? 'Resume to track topics' : 'Start speaking to build your knowledge map'}
        </span>
        <div className="flex items-center gap-2 mt-4">
          <PauseButton />
        </div>
      </div>
    )
  }

  // ── Loading state (coverage tab only) ────────────────────────────

  if (tab === 'coverage' && isLoading && topics.length === 0) {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center p-6"
        data-doc='{"icon":"mdi:map","title":"Knowledge Map","desc":"Calculating topic coverage..."}'
      >
        <PauseOverlay />
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 flex items-center justify-center mb-3">
          <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
        </div>
        <span className="text-[12px] font-semibold text-emerald-600">Calculating coverage...</span>
        <div className="flex items-center gap-2 mt-4">
          <PauseButton />
        </div>
      </div>
    )
  }

  // ── Main view ──────────────────────────────────────────────────────

  return (
    <div
      className="w-full h-full relative flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:map","title":"Knowledge Map","desc":"Sunburst visualization showing topic coverage. Vivid = well-covered, faint = gaps. Click domains to zoom."}'
    >
      <PauseOverlay />

      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Map size={13} className="text-emerald-500" />
          <span className="text-[11px] font-semibold text-slate-600">Knowledge Map</span>

          {/* Tab toggle */}
          <div className="flex items-center bg-slate-100/80 rounded-md p-0.5 ml-1.5">
            <button
              onClick={() => tab !== 'coverage' && setTab('coverage')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                tab === 'coverage'
                  ? 'bg-white text-slate-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-500'
              }`}
            >
              <Compass size={11} />
              Coverage
            </button>
            <button
              onClick={() => tab !== 'activity' && setTab('activity')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                tab === 'activity'
                  ? 'bg-white text-slate-600 shadow-sm'
                  : 'text-slate-400 hover:text-slate-500'
              }`}
            >
              <CalendarDays size={11} />
              Activity
            </button>
          </div>

          {tab === 'coverage' && (
            <button
              onClick={cycleTimeFilter}
              className="text-[9px] text-slate-400 hover:text-slate-600 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-100"
              title="Cycle: All → Today → This period"
            >
              {timeFilter === 'all' ? 'All time' : timeFilter === 'today' ? 'Today' : 'This period'} · {filteredTopics.length}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {tab === 'coverage' && (
            <button
              onClick={recalculate}
              disabled={isLoading}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-slate-100 hover:bg-slate-200/80 text-slate-500 rounded-full transition-all duration-200 disabled:opacity-50"
              title="Recalculate coverage scores"
            >
              <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}
          <PauseButton />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {tab === 'coverage' ? (
          <SunburstChart data={sunburstData} currentTopic={currentTopic} />
        ) : activityLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
          </div>
        ) : dailyCounts.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <CalendarDays className="w-5 h-5 text-slate-300" />
            <span className="text-[11px] text-slate-400">No activity yet</span>
          </div>
        ) : (
          <ActivityHeatmap dailyCounts={dailyCounts} months={months} getDayStats={getDayStats} />
        )}
      </div>

      {/* Footer (coverage tab only) */}
      {tab === 'coverage' && (
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-slate-100 flex items-center justify-between gap-2">
          {/* Current topic */}
          {currentTopic ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[10px] text-slate-500 truncate">
                Current: <span className="font-medium text-slate-700">{currentTopic}</span>
              </span>
            </div>
          ) : <div />}

          {/* Timings */}
          {(timings.baseMs !== null || timings.liveMs !== null || timings.groupMs !== null) && (
            <div className="flex items-center gap-1.5 shrink-0 text-[9px] text-slate-300 font-mono">
              {timings.baseMs !== null && <span title="Base coverage calculation">base {timings.baseMs === 0 ? 'cached' : `${timings.baseMs}ms`}</span>}
              {timings.liveMs !== null && <span title="Live topic reconstruction">live {timings.liveMs}ms</span>}
              {timings.groupMs !== null && <span title="Embedding-based grouping">group {timings.groupMs}ms</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
