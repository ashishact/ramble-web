/**
 * SynthesisWidget — SYS-II Period Extraction Monitor
 *
 * Shows recent 6-hour periods with their extraction status.
 * Allows manual trigger, commit, discard, and re-run.
 * During extraction, shows a live progress log.
 *
 * This is primarily a testing/dev tool — in production, the
 * PeriodScheduler runs automatically in the background.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { eventBus } from '../../lib/eventBus'
import {
  getExtractionEngine,
  loadAllPeriodStates,
  endedPeriods,
  periodKey,
  periodLabel,
  dateStr,
  currentSlot,
} from '../../modules/synthesis'
import type { PeriodExtractionState, PeriodSlot } from '../../modules/synthesis'
import {
  Brain,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronRight,
  Trash2,
  GitMerge,
} from 'lucide-react'

interface PeriodRow {
  date: string
  slot: PeriodSlot
  pKey: string
  label: string
  state: PeriodExtractionState | null
}

export function SynthesisWidget({ nodeId: _nodeId }: { nodeId: string }) {
  const [periods, setPeriods] = useState<PeriodRow[]>([])
  const [schedulerState, setSchedulerState] = useState<'idle' | 'running'>('idle')
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [progressLog, setProgressLog] = useState<Record<string, string[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const logRef = useRef<HTMLDivElement>(null)

  // Build the period list from storage + ended periods
  const refresh = useCallback(() => {
    const states = loadAllPeriodStates()
    const ended = endedPeriods(3)
    const rows: PeriodRow[] = ended.map(p => ({
      date: p.date,
      slot: p.slot,
      pKey: periodKey(p.date, p.slot),
      label: periodLabel(p.date, p.slot),
      state: states[periodKey(p.date, p.slot)] ?? null,
    })).reverse() // newest first
    setPeriods(rows)
  }, [])

  useEffect(() => {
    refresh()

    const unsubState = eventBus.on('synthesis:scheduler-state', ({ state }) => {
      setSchedulerState(state)
      if (state === 'idle') setRunningKey(null)
    })

    const unsubProgress = eventBus.on('synthesis:period-progress', ({ periodKey: pKey, message }) => {
      setProgressLog(prev => ({
        ...prev,
        [pKey]: [...(prev[pKey] ?? []), message].slice(-50), // keep last 50
      }))
      setRunningKey(pKey)
    })

    const unsubDone = eventBus.on('synthesis:period-done', () => {
      refresh()
    })

    const unsubError = eventBus.on('synthesis:period-error', () => {
      refresh()
    })

    return () => {
      unsubState()
      unsubProgress()
      unsubDone()
      unsubError()
    }
  }, [refresh])

  // Auto-scroll progress log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [progressLog])

  const handleRun = useCallback(async (row: PeriodRow) => {
    setRunningKey(row.pKey)
    setProgressLog(prev => ({ ...prev, [row.pKey]: [] }))
    setExpanded(prev => ({ ...prev, [row.pKey]: true }))
    const engine = getExtractionEngine()
    try {
      await engine.run(row.date, row.slot, msg => {
        setProgressLog(prev => ({
          ...prev,
          [row.pKey]: [...(prev[row.pKey] ?? []), msg].slice(-50),
        }))
      })
    } finally {
      refresh()
      setRunningKey(null)
    }
  }, [refresh])

  const handleCommit = useCallback(async (row: PeriodRow) => {
    const engine = getExtractionEngine()
    await engine.commit(row.pKey)
    refresh()
  }, [refresh])

  const handleDiscard = useCallback(async (row: PeriodRow) => {
    const engine = getExtractionEngine()
    await engine.discard(row.pKey)
    refresh()
  }, [refresh])

  const toggleExpanded = useCallback((pKey: string) => {
    setExpanded(prev => ({ ...prev, [pKey]: !prev[pKey] }))
  }, [])

  // Current period (not yet extractable)
  const currentPeriod = { date: dateStr(), slot: currentSlot() }
  const currentPKey = periodKey(currentPeriod.date, currentPeriod.slot)

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:brain","title":"SYS-II Synthesis","desc":"Manual trigger and monitor for the 6-hour knowledge synthesis engine."}'
    >
      {/* Header */}
      <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain size={14} className="text-cyan-500" />
            <span className="text-[11px] font-semibold text-slate-600">SYS-II Synthesis</span>
          </div>
          <div className="flex items-center gap-2">
            {schedulerState === 'running' && (
              <div className="flex items-center gap-1">
                <Loader2 size={10} className="text-cyan-500 animate-spin" />
                <span className="text-[9px] text-cyan-500">Running...</span>
              </div>
            )}
            <button
              onClick={refresh}
              className="p-1 rounded hover:bg-slate-100 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={11} className="text-slate-400" />
            </button>
          </div>
        </div>

        {/* Current period indicator */}
        <div className="mt-2 px-2 py-1 rounded-md bg-slate-50 border border-slate-100">
          <span className="text-[9px] text-slate-400">Current period: </span>
          <span className="text-[9px] font-medium text-slate-500">
            {periodLabel(currentPeriod.date, currentPeriod.slot)}
          </span>
          <span className="text-[9px] text-slate-300 ml-1">({currentPKey}) — in progress</span>
        </div>
      </div>

      {/* Period list */}
      <div className="flex-1 overflow-auto px-3 py-2 space-y-1.5">
        {periods.length === 0 && (
          <div className="flex items-center justify-center h-24 text-[11px] text-slate-400">
            No ended periods yet
          </div>
        )}

        {periods.map(row => {
          const isRunning = runningKey === row.pKey
          const isOpen = expanded[row.pKey]
          const logs = progressLog[row.pKey] ?? []

          return (
            <div key={row.pKey} className="rounded-lg border border-slate-100 overflow-hidden">
              {/* Row header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-slate-50/80 transition-colors">

                {/* Status icon */}
                <StatusIcon state={row.state} isRunning={isRunning} />

                {/* Label + key */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium text-slate-600 truncate">{row.label}</div>
                  <div className="text-[9px] text-slate-300">{row.pKey}</div>
                </div>

                {/* Counts (if done) */}
                {row.state?.status === 'done' || row.state?.status === 'committed' ? (
                  <div className="flex items-center gap-2 text-[9px] text-slate-400 shrink-0">
                    <span title="entities">{row.state.counts.entities}e</span>
                    <span title="memories">{row.state.counts.memories}m</span>
                    <span title="goals">{row.state.counts.goals}g</span>
                    <span title="topics">{row.state.counts.topics}t</span>
                  </div>
                ) : row.state?.conversationCount ? (
                  <span className="text-[9px] text-slate-300 shrink-0">
                    {row.state.conversationCount} convs
                  </span>
                ) : null}

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  {isRunning ? (
                    <Loader2 size={11} className="text-cyan-500 animate-spin" />
                  ) : row.state?.status === 'done' ? (
                    <>
                      <button
                        onClick={() => handleCommit(row)}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 rounded transition-colors"
                        title="Commit draft to main graph"
                      >
                        <GitMerge size={9} />
                        Commit
                      </button>
                      <button
                        onClick={() => handleDiscard(row)}
                        className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-500 transition-colors"
                        title="Discard draft"
                      >
                        <Trash2 size={10} />
                      </button>
                      <button
                        onClick={() => handleRun(row)}
                        className="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors"
                        title="Re-run extraction"
                      >
                        <RefreshCw size={10} />
                      </button>
                    </>
                  ) : row.state?.status === 'committed' ? (
                    <button
                      onClick={() => handleRun(row)}
                      className="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors"
                      title="Re-run extraction"
                    >
                      <RefreshCw size={10} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRun(row)}
                      disabled={isRunning}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 rounded transition-colors disabled:opacity-40"
                    >
                      <Play size={9} />
                      Run
                    </button>
                  )}

                  {/* Expand/collapse for logs */}
                  {(isRunning || logs.length > 0 || row.state?.compaction) && (
                    <button
                      onClick={() => toggleExpanded(row.pKey)}
                      className="p-1 rounded hover:bg-slate-100 text-slate-300 transition-colors"
                    >
                      {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Expandable log / compaction panel */}
              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50/70">
                  {/* Progress log */}
                  {logs.length > 0 && (
                    <div
                      ref={isRunning ? logRef : undefined}
                      className="px-3 py-2 max-h-24 overflow-auto"
                    >
                      {logs.map((msg, i) => (
                        <div key={i} className="text-[9px] text-slate-500 leading-relaxed font-mono">
                          {msg}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Compaction */}
                  {row.state?.compaction && !isRunning && (
                    <div className="px-3 py-2 border-t border-slate-100">
                      <div className="text-[9px] font-semibold text-slate-400 mb-1">Compaction</div>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        {row.state.compaction}
                      </p>
                    </div>
                  )}

                  {/* Error */}
                  {row.state?.error && (
                    <div className="px-3 py-2 border-t border-red-50">
                      <p className="text-[10px] text-red-500">{row.state.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Status icon ───────────────────────────────────────────────────────

function StatusIcon({
  state,
  isRunning,
}: {
  state: PeriodExtractionState | null
  isRunning: boolean
}) {
  if (isRunning) return <Loader2 size={12} className="text-cyan-500 animate-spin shrink-0" />
  if (!state || state.status === 'pending') return <Clock size={12} className="text-slate-300 shrink-0" />
  if (state.status === 'running')    return <Loader2 size={12} className="text-cyan-500 animate-spin shrink-0" />
  if (state.status === 'done')       return <div className="w-3 h-3 rounded-full bg-amber-400 shrink-0" title="Draft — not committed" />
  if (state.status === 'committed')  return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
  if (state.status === 'error')      return <XCircle size={12} className="text-red-400 shrink-0" />
  return <Clock size={12} className="text-slate-300 shrink-0" />
}
