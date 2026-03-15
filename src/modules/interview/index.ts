/**
 * Interview Module — Singleton Management
 *
 * Lazy-initializes the InterviewEngine and provides start/stop lifecycle.
 */

import { InterviewEngine } from './InterviewEngine'

let engine: InterviewEngine | null = null

/**
 * Get (or create + start) the singleton InterviewEngine.
 * Safe to call multiple times — only one instance is ever created.
 * Start is async (bootstraps from DB on first load) but fire-and-forget.
 */
export function getInterviewEngine(): InterviewEngine {
  if (!engine) {
    engine = new InterviewEngine()
    engine.start().catch(err => {
      console.error('[InterviewEngine] Failed to start:', err)
    })
  }
  return engine
}

/**
 * Stop and dispose the InterviewEngine singleton.
 */
export function stopInterviewEngine(): void {
  if (engine) {
    engine.stop()
    engine = null
  }
}
