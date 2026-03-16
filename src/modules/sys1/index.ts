/**
 * SYS-I Module — Singleton Management
 *
 * Lazy-initializes the Sys1Engine and provides start/stop lifecycle.
 */

import { Sys1Engine } from './Sys1Engine'

let engine: Sys1Engine | null = null

/**
 * Get (or create + start) the singleton Sys1Engine.
 * Safe to call multiple times — only one instance is ever created.
 * Start is async (bootstraps from DB on first load) but fire-and-forget.
 */
export function getSys1Engine(): Sys1Engine {
  if (!engine) {
    engine = new Sys1Engine()
    engine.start().catch(err => {
      console.error('[Sys1Engine] Failed to start:', err)
    })
  }
  return engine
}

/**
 * Stop and dispose the Sys1Engine singleton.
 */
export function stopSys1Engine(): void {
  if (engine) {
    engine.stop()
    engine = null
  }
}
