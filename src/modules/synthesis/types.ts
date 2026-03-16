/**
 * SYS-II Synthesis — Types
 */

// ── Periods ──────────────────────────────────────────────────────────

export type PeriodSlot = 'p1' | 'p2' | 'p3' | 'p4'

/**
 * pending   — never run
 * running   — in progress
 * interim   — ran while the period was still active (mid-period test run);
 *             the scheduler will re-run it automatically once the period ends
 * done      — ran after the period ended; draft nodes ready to commit
 * error     — last run failed
 * committed — user merged the draft into the main graph
 */
export type ExtractionStatus = 'pending' | 'running' | 'interim' | 'done' | 'error' | 'committed'

/**
 * Persisted state for a single period extraction run.
 * Stored in profileStorage keyed by periodKey ("YYYY-MM-DD-p2").
 */
export interface PeriodExtractionState {
  periodKey: string         // "2026-03-15-p2"
  date: string              // "2026-03-15"
  slot: PeriodSlot          // "p2"
  status: ExtractionStatus
  branchId: string | null   // Graph branch holding draft nodes
  conversationCount: number
  extractedAt: number | null
  compaction: string | null // Summary fed to the next period's context
  chatSessionId: string | null
  chatUrl: string | null
  error: string | null
  // Extracted node counts (filled after extraction)
  counts: {
    entities: number
    memories: number
    goals: number
    topics: number
    relationships: number
  }
}

// ── Memory Types ─────────────────────────────────────────────────────

export type MemorySlotType =
  | 'DEADLINE'
  | 'HEALTH'
  | 'RELATIONSHIP'
  | 'FINANCIAL'
  | 'DECISION'
  | 'EVENT'
  | 'FACT'
  | 'GENERIC'

// ── Extraction Output ────────────────────────────────────────────────

export interface ExtractedEntity {
  name: string
  type: 'person' | 'organization' | 'location' | 'product' | 'concept' | 'other'
  description?: string
  aliases?: string[]
  /** Distinguishing qualifiers for disambiguation (e.g. { department: "marketing", company: "Acme" }) */
  qualifiers?: Record<string, string>
  confidence: number
  /** Indices into the conversation array sent to the LLM */
  sourceIndices: number[]
}

export interface ExtractedRelationship {
  source: string   // entity name (resolved to node ID at write time)
  target: string   // entity name (resolved to node ID at write time)
  type: string     // free-form — LLM chooses (e.g. USES, WORKS_AT, PART_OF)
  description?: string
  confidence: number
  sourceIndices: number[]
}

export interface ExtractedMemory {
  content: string
  importance: number
  confidence: number
  /** Category of memory — tells us which slot fields apply */
  type: MemorySlotType
  /**
   * Only the fields that are MISSING / unknown.
   * Known fields are omitted entirely — content already carries them.
   * e.g. if owner is unknown: { owner: null }
   * If everything is known: {}
   */
  slots: Record<string, null>
  relatedEntityNames: string[]
  /** Indices into the conversation array sent to the LLM */
  sourceIndices: number[]
}

export interface ExtractedGoal {
  statement: string
  type: 'short-term' | 'long-term' | 'recurring' | 'milestone'
  motivation?: string
  deadline?: string
  confidence: number
  /** Indices into the conversation array sent to the LLM */
  sourceIndices: number[]
}

export interface ExtractedTopic {
  name: string
  confidence: number
  /** Indices into the conversation array sent to the LLM */
  sourceIndices: number[]
}

export interface ExtractionSearchRequest {
  query: string
  type: 'memory' | 'entity' | 'goal'
}

/** Full JSON response from SYS-II LLM call */
export interface ExtractionLLMResponse {
  entities: ExtractedEntity[]
  memories: ExtractedMemory[]
  goals: ExtractedGoal[]
  topics: ExtractedTopic[]
  relationships: ExtractedRelationship[]
  compaction: string
  search: ExtractionSearchRequest | null
}

/** Summary of what was written to the graph during one extraction run */
export interface ExtractionSummary {
  periodKey: string
  branchId: string
  entities: number
  memories: number
  goals: number
  topics: number
  relationships: number
  compaction: string
}
