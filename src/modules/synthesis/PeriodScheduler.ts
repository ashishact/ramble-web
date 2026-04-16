/**
 * PeriodScheduler — SYS-II Automatic Trigger
 *
 * Finds periods that have ended but haven't been extracted yet and runs
 * the ExtractionEngine on them. Works correctly even if the browser was
 * closed for days — on startup it catches up on all missed periods.
 *
 * Trigger logic:
 *   On start:       scan back MAX_LOOKBACK_DAYS and run everything missed
 *   Every 10 min:   check if any new period has ended since last check
 *
 * No idle detection — a period is either ended or it isn't.
 * If we're in p3 and p1 wasn't extracted, p1 runs immediately (oldest first).
 */

import { createLogger } from '../../program/utils/logger'
import { eventBus } from '../../lib/eventBus'
import { ExtractionEngine, loadPeriodState } from './ExtractionEngine'
import { endedPeriods, periodKey } from './periodUtils'
import { isSys2ConsolidationEnabled } from '../../graph/featureFlags'
import type { PeriodSlot } from './types'

const log = createLogger('PeriodScheduler')

const CHECK_INTERVAL_MS = 10 * 60 * 1000   // 10 minutes

export class PeriodScheduler {
  private engine = new ExtractionEngine()
  private timer: ReturnType<typeof setInterval> | null = null
  private queue: Array<{ date: string; slot: PeriodSlot }> = []
  private processing = false

  start(): void {
    if (!isSys2ConsolidationEnabled()) {
      log.info('SYS-II consolidation disabled (feature flag off) — skipping')
      return
    }
    if (this.timer) return
    log.info('Starting')

    // Immediate startup catch-up
    this.check().catch(err => log.error('Startup check failed:', err))

    // Periodic check
    this.timer = setInterval(() => {
      this.check().catch(err => log.error('Periodic check failed:', err))
    }, CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    log.info('Stopped')
  }

  isRunning(): boolean {
    return this.processing
  }

  /**
   * Manually trigger extraction for a specific period.
   * Bypasses the "already extracted" check — always re-runs.
   */
  async runNow(
    date: string,
    slot: PeriodSlot,
    onProgress?: (msg: string) => void,
  ): Promise<void> {
    const pKey = periodKey(date, slot)
    log.info('Manual run requested for', pKey)
    emitSchedulerState('running')

    try {
      const summary = await this.engine.run(date, slot, onProgress)
      eventBus.emit('synthesis:period-done', { periodKey: pKey, summary })
      emitSchedulerState('idle')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      eventBus.emit('synthesis:period-error', { periodKey: pKey, error: msg })
      emitSchedulerState('idle')
      throw err
    }
  }

  // ── Private ────────────────────────────────────────────────────────

  private async check(): Promise<void> {
    if (this.processing) return

    const periods = endedPeriods()
    const todo: Array<{ date: string; slot: PeriodSlot }> = []
    for (const p of periods) {
      const pKey = periodKey(p.date, p.slot)
      const state = await loadPeriodState(pKey)
      // Run if: never run, or mid-period test run (interim)
      if (!state || state.status === 'pending' || state.status === 'interim') { todo.push(p); continue }
      // Error with no chatUrl: safe to auto-retry (ChatGPT session was never created)
      // Error with chatUrl: DON'T auto-retry — the ChatGPT session already exists.
      // User must manually click Re-run, which will resume from the saved chatUrl
      // instead of opening a duplicate tab.
      if (state.status === 'error' && !state.chatUrl) { todo.push(p); continue }
      // Skip: running, done, committed, or error-with-chatUrl
    }

    if (todo.length === 0) return

    log.info(`Found ${todo.length} period(s) to extract:`, todo.map(p => periodKey(p.date, p.slot)).join(', '))

    // Enqueue all and drain one at a time
    this.queue.push(...todo)
    this.drainQueue()
  }

  private drainQueue(): void {
    if (this.processing || this.queue.length === 0) return

    this.processing = true
    emitSchedulerState('running')

    const next = this.queue.shift()!
    const pKey = periodKey(next.date, next.slot)
    log.info('Processing period:', pKey)

    this.engine.run(next.date, next.slot, (msg) => {
      eventBus.emit('synthesis:period-progress', { periodKey: pKey, message: msg })
    })
      .then(summary => {
        eventBus.emit('synthesis:period-done', { periodKey: pKey, summary })
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err)
        log.error('Extraction failed for', pKey, err)
        eventBus.emit('synthesis:period-error', { periodKey: pKey, error: msg })
      })
      .finally(() => {
        this.processing = false
        // Check if more in queue
        if (this.queue.length > 0) {
          this.drainQueue()
        } else {
          emitSchedulerState('idle')
        }
      })
  }
}

function emitSchedulerState(state: 'idle' | 'running'): void {
  eventBus.emit('synthesis:scheduler-state', { state })
}
