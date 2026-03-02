/**
 * Recording Types — Universal Recording Concept
 *
 * PHILOSOPHY: Everything is a Recording
 * ═══════════════════════════════════════
 * Whether the user speaks, types, pastes, drops a file, or uploads an image —
 * it all becomes a Recording. The type signals HOW the content arrived, which
 * determines information density weighting:
 *
 *   - voice: Physical bottleneck (~150 wpm). High confidence — the user chose
 *     every word through the effort of speaking. STT may get words wrong, but
 *     what they're REALLY talking about emerges from recurrence.
 *
 *   - text/paste: Keyboard has higher throughput than speech. Pasted content
 *     especially may be third-party (copied from email, article, etc.), so
 *     lower confidence for entity extraction.
 *
 *   - document/image: No effort filter — the user just dropped a file. Could
 *     be their own writing or someone else's. Topics yes (what it's about),
 *     entities are noise until confirmed.
 *
 * The throughputRate field captures this physical bottleneck as chars/sec.
 * Speech is slow (~2.5 chars/sec), paste is instantaneous (Infinity → capped).
 * This rate is the signal for confidence calibration downstream.
 *
 * PROCESSING MODES: System I vs System II
 * ════════════════════════════════════════
 * Inspired by Kahneman's dual-process theory:
 *
 *   - System I (fast thinking): Fires on each intermediate chunk during a
 *     live recording. Shallow context (small WorkingMemory). Saves to DB
 *     for time travel, but no durability guarantee. Fire-and-forget.
 *
 *   - System II (slow thinking): Fires after a recording ends with the
 *     complete text. Deep context (medium WorkingMemory). Durable via
 *     task queue — retries on failure.
 *
 * Both use the SAME extraction pipeline, SAME LLM prompt, SAME DB saves.
 * The difference is context depth, not processing logic.
 */

// ============================================================================
// Recording Types
// ============================================================================

/**
 * How the content arrived — determines information density weighting.
 * Maps to existing ConversationSource but expanded for file uploads.
 */
export type RecordingType = 'voice' | 'text' | 'paste' | 'document' | 'image'

/**
 * Processing mode — System I (fast/shallow) or System II (slow/deep).
 */
export type ProcessingMode = 'system-i' | 'system-ii'

/**
 * A Recording represents a single input session — from start to end.
 * Could be a 30-second voice memo, a single typed sentence, a pasted
 * paragraph, or a dropped PDF.
 */
export interface Recording {
  /** Unique identifier */
  id: string
  /** How the content arrived */
  type: RecordingType
  /** When the recording session began (Unix ms) */
  startedAt: number
  /** When the recording session ended (Unix ms). Null while active. */
  endedAt?: number
  /** For voice recordings: 'mic' or 'system' audio source */
  audioType?: 'mic' | 'system'
  /**
   * Characters per second — physical bottleneck signal.
   * Speech: ~2.5 chars/sec (150 wpm * 5 chars/word / 60 sec)
   * Typing: ~5-10 chars/sec
   * Paste: capped at 1000 (effectively instant)
   * Document: capped at 1000 (file drop is instant)
   */
  throughputRate?: number
  /** Where this recording originated */
  origin: 'in-app' | 'out-of-app'
  /** Current processing mode, if processing has started */
  mode?: ProcessingMode
}

// ============================================================================
// Recording Chunks
// ============================================================================

/**
 * A chunk of text from a recording — one intermediate transcription segment
 * for voice, or the full text for text/paste/document inputs.
 */
export interface RecordingChunk {
  /** Which recording this belongs to */
  recordingId: string
  /** The text content of this chunk */
  text: string
  /** Sequential index within the recording (0-based) */
  chunkIndex: number
  /** When this chunk was received (Unix ms) */
  timestamp: number
  /** For voice chunks: audio source */
  audioType?: 'mic' | 'system'
  /** VAD segment start time (Unix ms) — present when native app provides timing */
  speechStartMs?: number
  /** VAD segment end time (Unix ms) — present when native app provides timing */
  speechEndMs?: number
}

// ============================================================================
// Normalization Hints
// ============================================================================

/**
 * Hints extracted during normalization (Phase 1) that guide context retrieval.
 *
 * VISION: Two-pass architecture solves the chicken-and-egg problem.
 * Pass 1 (normalization): LLM reads raw text and extracts approximate names
 *   and topics as search keys — "Charan Tandi", "project deadline", etc.
 * Pass 2 (extraction): Search keys find real DB entities/topics/memories.
 *   LLM now has full context: "Charan Tandi" matches entity "Charan Tandi"
 *   with history of 47 mentions, related to project "Ramble", etc.
 *
 * This solves: "How do we give the LLM relevant context if we don't know
 * what the user is talking about yet?" Answer: first pass gives approximate
 * keys, second pass uses them to fetch precise context.
 */
export interface NormalizationHints {
  /** Named entities detected in the text — approximate names for search */
  entityHints: Array<{
    /** The name as detected (may be misspelled by STT) */
    name: string
    /** Optional type hint: 'person', 'place', 'organization', etc. */
    type?: string
    /** How confident the normalization LLM is (0-1) */
    confidence: number
  }>
  /** Topics/themes detected in the text — search keys for topic matching */
  topicHints: Array<{
    /** Topic name or phrase */
    name: string
    /** Optional category: 'work', 'personal', 'health', etc. */
    category?: string
  }>
  /** Corrections that were applied during normalization */
  correctionsApplied: Array<{
    /** Original text (before correction) */
    from: string
    /** Corrected text (after correction) */
    to: string
  }>
}

// ============================================================================
// Processing Results (event payloads)
// ============================================================================

/**
 * Result emitted after consolidation ("sleep") runs.
 * Consolidation merges duplicates, decays old data, and cleans up.
 */
export interface ConsolidationResult {
  /** Number of entities merged/deduplicated */
  entitiesMerged: number
  /** Number of near-duplicate memories detected */
  duplicatesFound: number
  /** Number of memories decayed (activityScore reduced) */
  decayed: number
  /** Timestamp when consolidation ran */
  timestamp: number
}
