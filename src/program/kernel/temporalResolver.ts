/**
 * Temporal Resolver — Convert relative date expressions to absolute timestamps
 *
 * Pure date math, no LLM needed. Handles common relative expressions:
 *   - "tomorrow" → start of next day
 *   - "next week" → start of next Monday
 *   - "by Friday" → end of that Friday
 *   - "in 3 days" → referenceTime + 3 days
 *   - "last week" → start of previous Monday to end of previous Sunday
 *   - "this month" → start to end of current month
 *   - "next month" → start to end of next month
 *   - "today" → start of today
 *   - "yesterday" → start of yesterday
 *
 * This file is standalone — remove the import in processor.ts and temporal
 * fields simply won't be resolved (they'll stay as strings/undefined).
 */

// ============================================================================
// Helpers
// ============================================================================

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

/** Get the Monday of the week containing `date` */
function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  // Sunday = 0, Monday = 1 ... Saturday = 6
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return startOfDay(d)
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

/** Map day name to JS getDay() value (0=Sunday) */
const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

/**
 * Find the next occurrence of the given day of week on or after `from`.
 * If `from` IS that day, returns the NEXT week's occurrence.
 */
function nextDayOfWeek(from: Date, targetDay: number): Date {
  const d = new Date(from)
  const currentDay = d.getDay()
  let daysAhead = targetDay - currentDay
  if (daysAhead <= 0) daysAhead += 7
  d.setDate(d.getDate() + daysAhead)
  return d
}

// ============================================================================
// Main Resolver
// ============================================================================

export interface TemporalResult {
  validFrom?: number
  validUntil?: number
}

/**
 * Attempt to resolve a relative time expression to absolute timestamps.
 *
 * @param expression - The relative date string (e.g. "tomorrow", "next week", "by Friday")
 * @param referenceTime - Unix timestamp of the conversation (anchor point)
 * @returns Resolved timestamps, or null if expression doesn't match any pattern
 */
export function resolveTemporalExpression(
  expression: string,
  referenceTime: number
): TemporalResult | null {
  const ref = new Date(referenceTime)
  const input = expression.toLowerCase().trim()

  // ── Exact matches ─────────────────────────────────────────────────────

  if (input === 'today') {
    return { validFrom: startOfDay(ref).getTime() }
  }

  if (input === 'tomorrow') {
    const d = new Date(ref)
    d.setDate(d.getDate() + 1)
    return { validFrom: startOfDay(d).getTime() }
  }

  if (input === 'yesterday') {
    const d = new Date(ref)
    d.setDate(d.getDate() - 1)
    return { validFrom: startOfDay(d).getTime() }
  }

  if (input === 'next week') {
    const thisMonday = startOfWeek(ref)
    const nextMonday = new Date(thisMonday)
    nextMonday.setDate(nextMonday.getDate() + 7)
    return { validFrom: nextMonday.getTime() }
  }

  if (input === 'this week') {
    const monday = startOfWeek(ref)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    return { validFrom: monday.getTime(), validUntil: endOfDay(sunday).getTime() }
  }

  if (input === 'last week') {
    const thisMonday = startOfWeek(ref)
    const prevMonday = new Date(thisMonday)
    prevMonday.setDate(prevMonday.getDate() - 7)
    const prevSunday = new Date(thisMonday)
    prevSunday.setDate(prevSunday.getDate() - 1)
    return { validFrom: prevMonday.getTime(), validUntil: endOfDay(prevSunday).getTime() }
  }

  if (input === 'this month') {
    return { validFrom: startOfMonth(ref).getTime(), validUntil: endOfMonth(ref).getTime() }
  }

  if (input === 'next month') {
    const nextM = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)
    return { validFrom: nextM.getTime(), validUntil: endOfMonth(nextM).getTime() }
  }

  // ── "in N days/weeks/months" ──────────────────────────────────────────

  const inNMatch = input.match(/^in\s+(\d+)\s+(day|days|week|weeks|month|months)$/)
  if (inNMatch) {
    const n = parseInt(inNMatch[1], 10)
    const unit = inNMatch[2]
    const d = new Date(ref)

    if (unit.startsWith('day')) {
      d.setDate(d.getDate() + n)
    } else if (unit.startsWith('week')) {
      d.setDate(d.getDate() + n * 7)
    } else if (unit.startsWith('month')) {
      d.setMonth(d.getMonth() + n)
    }

    return { validFrom: startOfDay(d).getTime() }
  }

  // ── "by <day>" / "by <day name>" ──────────────────────────────────────

  const byDayMatch = input.match(/^by\s+(.+)$/)
  if (byDayMatch) {
    const dayStr = byDayMatch[1].trim()
    const dayNum = DAY_NAMES[dayStr]
    if (dayNum !== undefined) {
      const target = nextDayOfWeek(ref, dayNum)
      return { validUntil: endOfDay(target).getTime() }
    }
  }

  // ── "on <day name>" / "this <day name>" / "next <day name>" ───────────

  const onDayMatch = input.match(/^(?:on|this|next)\s+(.+)$/)
  if (onDayMatch) {
    const dayStr = onDayMatch[1].trim()
    const dayNum = DAY_NAMES[dayStr]
    if (dayNum !== undefined) {
      const target = nextDayOfWeek(ref, dayNum)
      return { validFrom: startOfDay(target).getTime() }
    }
  }

  // ── ISO date string passthrough ───────────────────────────────────────

  const isoMatch = input.match(/^\d{4}-\d{2}-\d{2}/)
  if (isoMatch) {
    const parsed = new Date(input)
    if (!isNaN(parsed.getTime())) {
      return { validFrom: parsed.getTime() }
    }
  }

  // No pattern matched
  return null
}
