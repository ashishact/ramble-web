/**
 * SYS-I Debug Store — Stores debug traces for each SYS-I exchange
 *
 * Module-level Map keyed by conversation record ID (from DuckDB).
 * Populated by Sys1Engine after each flush, consumed by ConversationEntry
 * to render a collapsible debug panel below SYS-I responses.
 *
 * Not persisted — debug traces are ephemeral within a page session.
 */

export interface Sys1SearchTrace {
  query: string
  type: string
  limit?: number
  relevance?: number
  resultsLength: number
  resultPreview: string  // First 300 chars of search results
}

export interface Sys1DebugTrace {
  transport: string
  rawOutput: string
  parsedIntent: string
  parsedEmotion: string
  parsedTopic: string | undefined
  userInput: string
  searches: Sys1SearchTrace[]
  totalDurationMs: number
}

const traces = new Map<string, Sys1DebugTrace>()
const subscribers = new Set<() => void>()

export function setDebugTrace(convId: string, trace: Sys1DebugTrace): void {
  traces.set(convId, trace)
  // Cap at 50 entries to prevent unbounded growth
  if (traces.size > 50) {
    const first = traces.keys().next().value
    if (first) traces.delete(first)
  }
  for (const cb of subscribers) { try { cb() } catch {} }
}

export function getDebugTrace(convId: string): Sys1DebugTrace | undefined {
  return traces.get(convId)
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
