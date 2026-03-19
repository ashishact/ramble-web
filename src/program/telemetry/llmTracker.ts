/**
 * LLM Cost Tracker — Records every LLM call and computes aggregated costs.
 *
 * Called from llmClient.ts after each callLLM() completes.
 * Stores records in memory + localStorage. Provides aggregation views
 * by category, model, and day.
 *
 * subscribe()/getSnapshot() for React useSyncExternalStore.
 */

import type { LLMCallRecord, CostEntry, LLMUsageSnapshot } from './types'

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'ramble_llm_usage'
const MAX_RECORDS = 500
const PERSIST_INTERVAL_MS = 5_000

// ============================================================================
// Static Pricing Table (USD per 1M tokens)
// ============================================================================

/**
 * Approximate cost per 1M tokens for known models.
 * Update as pricing changes. Unknown models default to groq pricing.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  // Groq
  'openai/gpt-oss-120b': { input: 0.0, output: 0.0 },  // Free tier / flat rate
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  // Gemini
  'google/gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  // Anthropic
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
}

const DEFAULT_PRICING = { input: 0.50, output: 1.50 }

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] ?? DEFAULT_PRICING
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

// ============================================================================
// State
// ============================================================================

let records: LLMCallRecord[] = []
let dirty = false
let persistTimer: ReturnType<typeof setInterval> | null = null
let listeners: Set<() => void> = new Set()
let cachedSnapshot: LLMUsageSnapshot | null = null

// ============================================================================
// ID Generation
// ============================================================================

import { nid } from '../utils/id'

function nextId(): string {
  return nid.llm()
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Record a completed LLM call. Fire-and-forget, never throws.
 */
function recordLLMCall(record: Omit<LLMCallRecord, 'id'>): void {
  try {
    const full: LLMCallRecord = { ...record, id: nextId() }
    records.push(full)
    if (records.length > MAX_RECORDS) {
      records = records.slice(-MAX_RECORDS)
    }
    dirty = true
    cachedSnapshot = null
    notify()
  } catch {
    // Never break the caller
  }
}

// ============================================================================
// Aggregation
// ============================================================================

function aggregate(
  filterFn: (r: LLMCallRecord) => boolean,
  keyFn: (r: LLMCallRecord) => string,
): CostEntry[] {
  const map = new Map<string, CostEntry>()

  for (const r of records) {
    if (!filterFn(r)) continue
    const key = keyFn(r)
    let entry = map.get(key)
    if (!entry) {
      entry = { key, callCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 }
      map.set(key, entry)
    }
    entry.callCount++
    entry.inputTokens += r.inputTokens
    entry.outputTokens += r.outputTokens
    entry.totalTokens += r.inputTokens + r.outputTokens
    entry.estimatedCost += estimateCost(r.model, r.inputTokens, r.outputTokens)
  }

  return Array.from(map.values()).sort((a, b) => b.estimatedCost - a.estimatedCost)
}

function getUsageByCategory(timeFilter?: 'today' | 'week' | 'all'): CostEntry[] {
  const cutoff = getTimeCutoff(timeFilter)
  return aggregate(r => r.ts >= cutoff, r => r.category)
}

function getUsageByModel(timeFilter?: 'today' | 'week' | 'all'): CostEntry[] {
  const cutoff = getTimeCutoff(timeFilter)
  return aggregate(r => r.ts >= cutoff, r => r.model)
}

function getUsageByDay(timeFilter?: 'today' | 'week' | 'all'): CostEntry[] {
  const cutoff = getTimeCutoff(timeFilter)
  return aggregate(
    r => r.ts >= cutoff,
    r => new Date(r.ts).toISOString().slice(0, 10)
  ).sort((a, b) => b.key.localeCompare(a.key))
}

function getDailyCosts(): CostEntry[] {
  return getUsageByDay('all')
}

function getTotalCost(timeFilter?: 'today' | 'week' | 'all'): number {
  const cutoff = getTimeCutoff(timeFilter)
  let total = 0
  for (const r of records) {
    if (r.ts >= cutoff) {
      total += estimateCost(r.model, r.inputTokens, r.outputTokens)
    }
  }
  return total
}

function getTimeCutoff(filter?: 'today' | 'week' | 'all'): number {
  if (!filter || filter === 'all') return 0
  const now = new Date()
  if (filter === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  }
  // week
  const dayOfWeek = now.getDay()
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek)
  return startOfWeek.getTime()
}

// ============================================================================
// React Integration
// ============================================================================

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  ensurePersistTimer()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): LLMUsageSnapshot {
  if (!cachedSnapshot) {
    let totalInput = 0, totalOutput = 0, totalCost = 0
    for (const r of records) {
      totalInput += r.inputTokens
      totalOutput += r.outputTokens
      totalCost += estimateCost(r.model, r.inputTokens, r.outputTokens)
    }
    cachedSnapshot = {
      records: [...records],
      totalCalls: records.length,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalEstimatedCost: totalCost,
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
// Clear
// ============================================================================

function clearRecords(): void {
  records = []
  dirty = true
  cachedSnapshot = null
  notify()
  persistNow()
}

// ============================================================================
// Persistence
// ============================================================================

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { records?: LLMCallRecord[] }
    if (Array.isArray(parsed.records)) {
      records = parsed.records.slice(-MAX_RECORDS)
    }
  } catch {
    // Corrupt — start fresh
  }
}

function persistNow(): void {
  if (!dirty) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ records }))
    dirty = false
  } catch {
    // localStorage unavailable
  }
}

function ensurePersistTimer(): void {
  if (persistTimer) return
  if (records.length === 0) {
    loadFromStorage()
    cachedSnapshot = null
  }
  persistTimer = setInterval(persistNow, PERSIST_INTERVAL_MS)
}

// ============================================================================
// Export singleton
// ============================================================================

export const llmTracker = {
  recordLLMCall,
  subscribe,
  getSnapshot,
  getUsageByCategory,
  getUsageByModel,
  getUsageByDay,
  getDailyCosts,
  getTotalCost,
  clearRecords,
}
