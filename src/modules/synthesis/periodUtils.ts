/**
 * Period Utilities — 6-hour time window helpers
 *
 * A "period" divides each day into 4 equal 6-hour windows:
 *   p1: 00:00 – 06:00 (night)
 *   p2: 06:00 – 12:00 (morning)
 *   p3: 12:00 – 18:00 (afternoon)
 *   p4: 18:00 – 24:00 (evening)
 *
 * A period is "extractable" once its end boundary has passed.
 * We look back up to MAX_LOOKBACK_DAYS to catch periods missed when
 * the browser was closed.
 */

import type { PeriodSlot } from './types'

export const MAX_LOOKBACK_DAYS = 2

interface PeriodBounds {
  startHour: number
  endHour: number   // 24 means midnight next day
}

const SLOT_BOUNDS: Record<PeriodSlot, PeriodBounds> = {
  p1: { startHour: 0,  endHour: 6  },
  p2: { startHour: 6,  endHour: 12 },
  p3: { startHour: 12, endHour: 18 },
  p4: { startHour: 18, endHour: 24 },
}

/** YYYY-MM-DD string for a given timestamp (local time) */
export function dateStr(ts = Date.now()): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Which slot does the given hour (0-23) fall in? */
export function slotForHour(hour: number): PeriodSlot {
  if (hour < 6)  return 'p1'
  if (hour < 12) return 'p2'
  if (hour < 18) return 'p3'
  return 'p4'
}

/** The current period slot (based on local wall clock) */
export function currentSlot(): PeriodSlot {
  return slotForHour(new Date().getHours())
}

/** Unix ms bounds for a period given date string + slot */
export function periodMs(date: string, slot: PeriodSlot): { startMs: number; endMs: number } {
  const { startHour, endHour } = SLOT_BOUNDS[slot]
  const startMs = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`).getTime()
  const endMs   = endHour === 24
    ? new Date(`${date}T23:59:59.999`).getTime() + 1   // exclusive midnight
    : new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00`).getTime()
  return { startMs, endMs }
}

/** Composite key used for storage lookups: "YYYY-MM-DD-p2" */
export function periodKey(date: string, slot: PeriodSlot): string {
  return `${date}-${slot}`
}

/** Is this period fully in the past? (end boundary crossed) */
export function isPeriodEnded(date: string, slot: PeriodSlot): boolean {
  return Date.now() >= periodMs(date, slot).endMs
}

/**
 * All ended periods in the lookback window, oldest first.
 * Excludes the currently-active period.
 */
export function endedPeriods(lookbackDays = MAX_LOOKBACK_DAYS): Array<{ date: string; slot: PeriodSlot }> {
  const results: Array<{ date: string; slot: PeriodSlot }> = []
  const now = Date.now()

  for (let d = lookbackDays; d >= 0; d--) {
    const date = dateStr(now - d * 86_400_000)
    for (const slot of ['p1', 'p2', 'p3', 'p4'] as PeriodSlot[]) {
      if (isPeriodEnded(date, slot)) {
        results.push({ date, slot })
      }
    }
  }

  return results
}

/** Human-readable label for a period: "Mar 15 · Morning" */
export function periodLabel(date: string, slot: PeriodSlot): string {
  const labels: Record<PeriodSlot, string> = {
    p1: 'Night (12am–6am)',
    p2: 'Morning (6am–12pm)',
    p3: 'Afternoon (12pm–6pm)',
    p4: 'Evening (6pm–12am)',
  }
  const d = new Date(date + 'T12:00:00')
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${monthDay} · ${labels[slot]}`
}
