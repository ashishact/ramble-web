/**
 * Pipeline Telemetry — Core Event Accumulator
 *
 * The single instrumentation point for the entire pipeline.
 * Call sites just do: telemetry.emit('category', 'action', 'start'|'end', data?)
 *
 * This module:
 * - Pairs start/end events via correlationId to compute duration
 * - Keeps a rolling in-memory log (last 200 events)
 * - Groups events into pipeline runs
 * - Persists to localStorage every 5s (if dirty)
 * - Provides subscribe()/getSnapshot() for React useSyncExternalStore
 */

import type {
  TelemetryCategory,
  TelemetryPhase,
  TelemetryStatus,
  TelemetryEvent,
  TelemetrySnapshot,
  PipelineRun,
} from './types'

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'ramble_telemetry'
const MAX_EVENTS = 200
const MAX_RUNS = 20
const PERSIST_INTERVAL_MS = 5_000

// ============================================================================
// State
// ============================================================================

let events: TelemetryEvent[] = []
let runs: PipelineRun[] = []
let dirty = false
let persistTimer: ReturnType<typeof setInterval> | null = null
let listeners: Set<() => void> = new Set()
let cachedSnapshot: TelemetrySnapshot | null = null

// Active correlationId stack — the most recent 'kernel' start sets the current run
let activeCorrelationId: string | null = null

// ============================================================================
// ID Generation
// ============================================================================

import { nid } from '../utils/id'

function nextId(): string {
  return nid.telemetry()
}

function newCorrelationId(): string {
  return nid.run()
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Emit a telemetry event. Fire-and-forget, never throws.
 *
 * @param category - Pipeline stage
 * @param action - Specific action within the stage
 * @param phase - 'start' or 'end'
 * @param data - Optional payload (lengths, counts, identifiers)
 * @param options - Optional status (for 'end' phase), correlationId override
 */
function emit(
  category: TelemetryCategory,
  action: string,
  phase: TelemetryPhase,
  data?: Record<string, unknown>,
  options?: { status?: TelemetryStatus; correlationId?: string; isLLM?: boolean }
): string {
  try {
    // Determine correlation ID
    let correlationId: string
    if (options?.correlationId) {
      correlationId = options.correlationId
    } else if (phase === 'start' && category === 'kernel') {
      // New pipeline run
      correlationId = newCorrelationId()
      activeCorrelationId = correlationId
    } else {
      correlationId = activeCorrelationId ?? newCorrelationId()
    }

    const event: TelemetryEvent = {
      id: nextId(),
      category,
      action,
      phase,
      status: phase === 'end' ? (options?.status ?? 'success') : undefined,
      ts: Date.now(),
      data,
      correlationId,
      isLLM: options?.isLLM ?? category === 'llm',
    }

    // Add to event log (rolling)
    events.push(event)
    if (events.length > MAX_EVENTS) {
      events = events.slice(-MAX_EVENTS)
    }

    // Update pipeline runs
    updateRun(event)

    dirty = true
    cachedSnapshot = null
    notify()

    return correlationId
  } catch {
    // Never break the caller
    return activeCorrelationId ?? ''
  }
}

/**
 * Start a new pipeline run explicitly.
 * Returns the correlationId for the run.
 */
function startRun(): string {
  const correlationId = newCorrelationId()
  activeCorrelationId = correlationId
  return correlationId
}

// ============================================================================
// Run Tracking
// ============================================================================

function updateRun(event: TelemetryEvent): void {
  let run = runs.find(r => r.correlationId === event.correlationId)

  if (!run) {
    run = {
      correlationId: event.correlationId,
      startTs: event.ts,
      events: [],
      status: 'running',
    }
    runs.push(run)
    if (runs.length > MAX_RUNS) {
      runs = runs.slice(-MAX_RUNS)
    }
  }

  run.events.push(event)

  // Update run status from event
  if (event.phase === 'end') {
    if (event.status === 'error') {
      run.status = 'error'
    }
    // Mark run complete when kernel ends
    if (event.category === 'kernel' && event.action === 'processInputItem') {
      run.endTs = event.ts
      run.durationMs = event.ts - run.startTs
      if (run.status === 'running') {
        run.status = event.status === 'error' ? 'error' : 'success'
      }
    }
  }
}

// ============================================================================
// React Integration (useSyncExternalStore)
// ============================================================================

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  ensurePersistTimer()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): TelemetrySnapshot {
  if (!cachedSnapshot) {
    const activeRun = runs.find(r => r.status === 'running') ?? null
    // Deep-copy runs so each run object and its events array are new references.
    // Without this, useMemo dependencies on run.events never see changes
    // because updateRun() mutates the arrays in place.
    cachedSnapshot = {
      events: [...events],
      runs: runs.map(r => ({ ...r, events: [...r.events] })),
      activeRun: activeRun ? { ...activeRun, events: [...activeRun.events] } : null,
    }
  }
  return cachedSnapshot
}

function notify(): void {
  for (const listener of listeners) {
    try { listener() } catch { /* never break */ }
  }
}

// ============================================================================
// Query Helpers
// ============================================================================

function getRecentEvents(limit = 50): TelemetryEvent[] {
  return events.slice(-limit)
}

function getActivePipelineRun(): PipelineRun | null {
  return runs.find(r => r.status === 'running') ?? null
}

function clearEvents(): void {
  events = []
  runs = []
  activeCorrelationId = null
  dirty = true
  cachedSnapshot = null
  notify()
  persistNow()
}

// ============================================================================
// Persistence (localStorage)
// ============================================================================

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { events?: TelemetryEvent[]; runs?: PipelineRun[] }
    if (Array.isArray(parsed.events)) {
      events = parsed.events.slice(-MAX_EVENTS)
    }
    if (Array.isArray(parsed.runs)) {
      // Mark any previously-running runs as stale (app crashed/reloaded)
      runs = parsed.runs.slice(-MAX_RUNS).map(r => ({
        ...r,
        status: r.status === 'running' ? 'error' as const : r.status,
      }))
    }
  } catch {
    // Corrupt data — start fresh
  }
}

function persistNow(): void {
  if (!dirty) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ events, runs }))
    dirty = false
  } catch {
    // localStorage full or unavailable
  }
}

function ensurePersistTimer(): void {
  if (persistTimer) return
  // Load on first access
  if (events.length === 0 && runs.length === 0) {
    loadFromStorage()
    cachedSnapshot = null
  }
  persistTimer = setInterval(persistNow, PERSIST_INTERVAL_MS)
}

// ============================================================================
// Export singleton
// ============================================================================

export const telemetry = {
  emit,
  startRun,
  subscribe,
  getSnapshot,
  getRecentEvents,
  getActivePipelineRun,
  clearEvents,
}
