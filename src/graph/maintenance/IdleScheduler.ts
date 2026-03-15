/**
 * IdleScheduler — 5min Idle / 24hr Max Trigger
 *
 * Runs consolidation after 5 minutes of user inactivity
 * or after 24 hours since the last run, whichever comes first.
 *
 * Uses requestIdleCallback when available for minimal performance impact.
 */

import type { Consolidation } from './Consolidation'
import { createLogger } from '../../program/utils/logger'

const logger = createLogger('IdleScheduler')

const IDLE_THRESHOLD_MS = 5 * 60 * 1000      // 5 minutes idle
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000   // 24 hours max

export class IdleScheduler {
  private consolidation: Consolidation
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private lastRunTime: number | null = null
  private running = false
  private activityListeners: Array<() => void> = []

  constructor(consolidation: Consolidation) {
    this.consolidation = consolidation
  }

  /**
   * Start the scheduler. Attaches user activity listeners.
   */
  start(): void {
    if (typeof window === 'undefined') return

    this.resetIdleTimer()
    this.startMaxTimer()

    // Reset idle timer on user activity
    const reset = () => this.resetIdleTimer()
    window.addEventListener('keydown', reset, { passive: true })
    window.addEventListener('click', reset, { passive: true })
    window.addEventListener('scroll', reset, { passive: true })
    window.addEventListener('mousemove', reset, { passive: true })

    this.activityListeners.push(
      () => window.removeEventListener('keydown', reset),
      () => window.removeEventListener('click', reset),
      () => window.removeEventListener('scroll', reset),
      () => window.removeEventListener('mousemove', reset),
    )

    logger.info('Idle scheduler started')
  }

  /**
   * Stop the scheduler and clean up.
   */
  stop(): void {
    this.clearTimers()
    for (const cleanup of this.activityListeners) cleanup()
    this.activityListeners = []
    logger.info('Idle scheduler stopped')
  }

  // ==========================================================================
  // Timers
  // ==========================================================================

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.triggerConsolidation('idle'), IDLE_THRESHOLD_MS)
  }

  private startMaxTimer(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer)

    // Calculate time until next required run
    const elapsed = this.lastRunTime ? Date.now() - this.lastRunTime : MAX_INTERVAL_MS
    const remaining = Math.max(0, MAX_INTERVAL_MS - elapsed)

    this.maxTimer = setTimeout(() => this.triggerConsolidation('max-interval'), remaining)
  }

  private clearTimers(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
    if (this.maxTimer) { clearTimeout(this.maxTimer); this.maxTimer = null }
  }

  // ==========================================================================
  // Trigger
  // ==========================================================================

  private async triggerConsolidation(reason: string): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      logger.info('Triggering consolidation', { reason })

      // Use requestIdleCallback if available for minimal UI impact
      if ('requestIdleCallback' in window) {
        await new Promise<void>(resolve => {
          requestIdleCallback(async () => {
            await this.consolidation.run()
            resolve()
          }, { timeout: 10000 }) // 10s deadline
        })
      } else {
        await this.consolidation.run()
      }

      this.lastRunTime = Date.now()
    } catch (err) {
      logger.error('Consolidation failed', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.running = false
      this.resetIdleTimer()
      this.startMaxTimer()
    }
  }
}
