/**
 * SYS-II Synthesis — Types
 */

// ── Periods ──────────────────────────────────────────────────────────

export type PeriodSlot = 'p1' | 'p2' | 'p3' | 'p4'

export type ExtractionStatus = 'pending' | 'running' | 'done' | 'error' | 'committed'

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
  }
}

// ── Memory Slot Templates ────────────────────────────────────────────

export type MemorySlotType =
  | 'DEADLINE'
  | 'HEALTH'
  | 'RELATIONSHIP'
  | 'FINANCIAL'
  | 'DECISION'
  | 'EVENT'
  | 'FACT'
  | 'GENERIC'

export interface SlotDeadline   { project: string|null; owner: string|null; deadline: string|null; status: string|null }
export interface SlotHealth     { person: string|null; condition: string|null; severity: string|null; date: string|null; treatment: string|null }
export interface SlotRelation   { person: string|null; relationship_type: string|null; context: string|null }
export interface SlotFinancial  { amount: string|null; currency: string|null; purpose: string|null; date: string|null }
export interface SlotDecision   { decision: string|null; alternatives: string|null; rationale: string|null; date: string|null }
export interface SlotEvent      { what: string|null; when: string|null; where: string|null; who: string|null; outcome: string|null }
export interface SlotFact       { subject: string|null; predicate: string|null; object: string|null }
export interface SlotGeneric    { [key: string]: string|null }

export type MemorySlotTemplate =
  | { type: 'DEADLINE';      slots: SlotDeadline   }
  | { type: 'HEALTH';        slots: SlotHealth      }
  | { type: 'RELATIONSHIP';  slots: SlotRelation    }
  | { type: 'FINANCIAL';     slots: SlotFinancial   }
  | { type: 'DECISION';      slots: SlotDecision    }
  | { type: 'EVENT';         slots: SlotEvent       }
  | { type: 'FACT';          slots: SlotFact        }
  | { type: 'GENERIC';       slots: SlotGeneric     }

// ── Extraction Output ────────────────────────────────────────────────

export interface ExtractedEntity {
  name: string
  type: 'person' | 'organization' | 'location' | 'product' | 'concept' | 'other'
  description?: string
  aliases?: string[]
  confidence: number
}

export interface ExtractedMemory {
  content: string
  importance: number
  confidence: number
  slotTemplate: MemorySlotTemplate
  relatedEntityNames: string[]
  /** Indices into the conversation array sent to the LLM */
  sourceConversationIndices: number[]
}

export interface ExtractedGoal {
  statement: string
  type: 'immediate' | 'short_term' | 'long_term'
  motivation?: string
  deadline?: string
  confidence: number
}

export interface ExtractedTopic {
  name: string
  category?: string
  confidence: number
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
  compaction: string
}
