/**
 * Pipeline Telemetry — Shared Types
 *
 * Used by pipelineTelemetry.ts (event accumulator) and llmTracker.ts (cost tracker).
 */

// ============================================================================
// Pipeline Telemetry Events
// ============================================================================

export type TelemetryPhase = 'start' | 'end'
export type TelemetryStatus = 'success' | 'error' | 'skip'

/**
 * Categories map 1:1 to pipeline stages.
 * Each category emits start/end pairs for timing.
 */
export type TelemetryCategory =
  | 'kernel'           // submitInput, processQueue
  | 'normalize'        // normalizeInput pipeline
  | 'context'          // context retrieval
  | 'extraction'       // LLM extraction call
  | 'save'             // DB save phase
  | 'reinforce'        // auto-reinforce pass
  | 'follow-up'        // queue follow-up tasks
  | 'tree-editor'      // knowledge tree editing
  | 'timeline'         // timeline extraction
  | 'entity-resolution' // entity blocking + scoring
  | 'llm'              // raw LLM call (tracked separately in llmTracker)

export interface TelemetryEvent {
  id: string
  category: TelemetryCategory
  action: string           // e.g. 'submitInput', 'phase1-normalize', 'llm-call'
  phase: TelemetryPhase
  status?: TelemetryStatus // only on 'end' events
  ts: number               // Date.now()
  data?: Record<string, unknown>  // optional payload (lengths, counts, etc.)
  correlationId: string    // pairs start/end events; groups pipeline runs
  isLLM?: boolean          // true for events involving an LLM call
}

export interface PipelineRun {
  correlationId: string
  startTs: number
  endTs?: number
  durationMs?: number
  events: TelemetryEvent[]
  status: 'running' | 'success' | 'error'
}

// ============================================================================
// LLM Cost Tracking
// ============================================================================

export interface LLMCallRecord {
  id: string
  ts: number
  category: string        // who called: 'extraction', 'normalize', 'tree-editor', 'timeline', etc.
  tier: string            // 'small' | 'medium' | 'large'
  model: string           // resolved model name
  provider: string        // resolved provider
  inputTokens: number
  outputTokens: number
  durationMs: number
  status: 'success' | 'error'
  promptLength: number    // character count of prompt
  responseLength: number  // character count of response
}

/**
 * Aggregated cost entry for display.
 */
export interface CostEntry {
  key: string             // grouping key (category name, model name, or date)
  callCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number   // USD
}

/**
 * Snapshot of the full telemetry state, used by useSyncExternalStore.
 */
export interface TelemetrySnapshot {
  events: TelemetryEvent[]
  runs: PipelineRun[]
  activeRun: PipelineRun | null
}

export interface LLMUsageSnapshot {
  records: LLMCallRecord[]
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalEstimatedCost: number
}
