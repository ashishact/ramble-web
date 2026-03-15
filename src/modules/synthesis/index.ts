/**
 * Synthesis Module — Singleton Management
 *
 * Lazy-initializes the ExtractionEngine and PeriodScheduler.
 * The scheduler starts automatically when the graph is ready (called from BentoApp).
 */

import { ExtractionEngine } from './ExtractionEngine'
import { PeriodScheduler } from './PeriodScheduler'

export { ExtractionEngine } from './ExtractionEngine'
export { PeriodScheduler } from './PeriodScheduler'
export { loadPeriodState, loadAllPeriodStates } from './ExtractionEngine'
export { endedPeriods, periodKey, periodLabel, dateStr, currentSlot } from './periodUtils'
export type {
  PeriodSlot,
  PeriodExtractionState,
  ExtractionSummary,
  ExtractionStatus,
  MemorySlotType,
} from './types'

let _engine: ExtractionEngine | null = null
let _scheduler: PeriodScheduler | null = null

export function getExtractionEngine(): ExtractionEngine {
  if (!_engine) _engine = new ExtractionEngine()
  return _engine
}

export function getPeriodScheduler(): PeriodScheduler {
  if (!_scheduler) _scheduler = new PeriodScheduler()
  return _scheduler
}

/** Start the scheduler (called from BentoApp after graph init) */
export function startPeriodScheduler(): void {
  getPeriodScheduler().start()
}

/** Stop and dispose everything */
export function stopSynthesis(): void {
  _scheduler?.stop()
  _scheduler = null
  _engine = null
}
