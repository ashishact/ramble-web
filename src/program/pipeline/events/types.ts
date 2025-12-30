/**
 * Pipeline Event Types
 *
 * Defines all events in the durable event-driven pipeline.
 * Each task saves to DB before emitting its completion event.
 */

// ============================================================================
// Base Event Type
// ============================================================================

/**
 * Base interface for all pipeline events
 */
export interface PipelineEvent<T = unknown> {
  /** Event type identifier */
  type: PipelineEventType;
  /** Timestamp when event was emitted */
  timestamp: number;
  /** Correlation ID linking related events (typically unitId) */
  correlationId: string;
  /** Event-specific payload */
  payload: T;
}

// ============================================================================
// Event Type Enum
// ============================================================================

/**
 * All pipeline event types - defines the linear flow
 */
export type PipelineEventType =
  // Ingestion phase
  | 'unit:created'              // ConversationUnit created and saved

  // Pre-processing phase (JS only, bundled)
  | 'unit:preprocessed'         // Sanitization + corrections + spans computed

  // Extraction phase (LLM)
  | 'primitives:extracted'      // Single LLM call completed, primitives saved

  // Resolution phase (JS only)
  | 'entities:resolved'         // Entity mentions resolved, entities saved

  // Derivation phase (JS only)
  | 'claims:derived'            // Claims derived from propositions+stances, saved

  // Observer phase
  | 'observers:nonllm:completed' // All non-LLM observers done
  | 'observers:llm:completed'    // All LLM observers done

  // Completion
  | 'unit:completed'            // Full pipeline complete for unit

  // Background events
  | 'decay:scheduled'           // Memory decay triggered
  | 'session:ended';            // Session ended, trigger cleanup observers

// ============================================================================
// Event Payloads
// ============================================================================

/**
 * Payload when a ConversationUnit is created
 */
export interface UnitCreatedPayload {
  unitId: string;
  sessionId: string;
  rawText: string;
  source: 'speech' | 'text';
}

/**
 * Payload when preprocessing is complete
 */
export interface UnitPreprocessedPayload {
  unitId: string;
  sessionId: string;
  sanitizedText: string;
  spanIds: string[];
  correctionResult?: {
    applied: number;
    learned: number;
  };
}

/**
 * Payload when primitives are extracted via LLM
 */
export interface PrimitivesExtractedPayload {
  unitId: string;
  sessionId: string;
  propositionIds: string[];
  stanceIds: string[];
  relationIds: string[];
  /** Raw entity mentions from LLM - NOT yet stored, will be created+resolved in next step */
  rawEntityMentions: Array<{
    text: string;
    mentionType: string;
    suggestedType: string;
    spanId?: string;
  }>;
  llmMetadata: {
    model: string;
    tokensUsed: number;
    processingTimeMs: number;
  };
}

/**
 * Payload when entities are resolved
 */
export interface EntitiesResolvedPayload {
  unitId: string;
  sessionId: string;
  resolvedMentionIds: string[];
  newEntityIds: string[];
  stats: {
    matchedExisting: number;
    createdNew: number;
    pronounsResolved: number;
  };
}

/**
 * Payload when claims are derived
 */
export interface ClaimsDerivedPayload {
  unitId: string;
  sessionId: string;
  claimIds: string[];
}

/**
 * Payload when observers complete
 */
export interface ObserversCompletedPayload {
  unitId: string;
  sessionId: string;
  observerType: 'nonllm' | 'llm';
  results: Array<{
    observerType: string;
    hasOutput: boolean;
    outputCount: number;
  }>;
}

/**
 * Payload when a unit is fully processed
 */
export interface UnitCompletedPayload {
  unitId: string;
  sessionId: string;
  totalProcessingTimeMs: number;
  summary: {
    claims: number;
    entities: number;
    observerOutputs: number;
  };
}

/**
 * Payload for decay scheduling
 */
export interface DecayScheduledPayload {
  scheduledAt: number;
  reason: 'periodic' | 'manual';
}

/**
 * Payload when session ends
 */
export interface SessionEndedPayload {
  sessionId: string;
  endedAt: number;
}

// ============================================================================
// Pipeline Task Types (for durable queue)
// ============================================================================

/**
 * Pipeline task types - each maps to an event handler
 */
export type PipelineTaskType =
  | 'preprocess_unit'      // JS only: sanitize + corrections + spans
  | 'extract_primitives'   // LLM: single extraction call
  | 'resolve_and_derive'   // JS only: entity resolution + claim derivation
  | 'run_nonllm_observers' // JS only: batched non-LLM observers
  | 'run_llm_observers'    // LLM: batched LLM observers
  | 'run_decay';           // Background: memory decay

/**
 * Mapping from event type to next task type
 * Defines the linear flow of the pipeline
 */
export const EVENT_TO_TASK_MAP: Partial<Record<PipelineEventType, PipelineTaskType>> = {
  'unit:created': 'preprocess_unit',
  'unit:preprocessed': 'extract_primitives',
  'primitives:extracted': 'resolve_and_derive',
  'claims:derived': 'run_nonllm_observers',
  'observers:nonllm:completed': 'run_llm_observers',
  // 'observers:llm:completed' → no next task, marks unit complete
};

/**
 * Recovery mapping: given last completed event, which task to run next
 */
export const RECOVERY_TASK_MAP: Partial<Record<PipelineEventType, PipelineTaskType>> = {
  'unit:created': 'preprocess_unit',
  'unit:preprocessed': 'extract_primitives',
  'primitives:extracted': 'resolve_and_derive',
  'entities:resolved': 'run_nonllm_observers', // Skip to observers if entities done
  'claims:derived': 'run_nonllm_observers',
  'observers:nonllm:completed': 'run_llm_observers',
  // 'observers:llm:completed' and 'unit:completed' → nothing to recover
};

// ============================================================================
// Type Guards
// ============================================================================

export function isUnitCreatedEvent(event: PipelineEvent): event is PipelineEvent<UnitCreatedPayload> {
  return event.type === 'unit:created';
}

export function isUnitPreprocessedEvent(event: PipelineEvent): event is PipelineEvent<UnitPreprocessedPayload> {
  return event.type === 'unit:preprocessed';
}

export function isPrimitivesExtractedEvent(event: PipelineEvent): event is PipelineEvent<PrimitivesExtractedPayload> {
  return event.type === 'primitives:extracted';
}

export function isEntitiesResolvedEvent(event: PipelineEvent): event is PipelineEvent<EntitiesResolvedPayload> {
  return event.type === 'entities:resolved';
}

export function isClaimsDerivedEvent(event: PipelineEvent): event is PipelineEvent<ClaimsDerivedPayload> {
  return event.type === 'claims:derived';
}

export function isObserversCompletedEvent(event: PipelineEvent): event is PipelineEvent<ObserversCompletedPayload> {
  return event.type === 'observers:nonllm:completed' || event.type === 'observers:llm:completed';
}

export function isUnitCompletedEvent(event: PipelineEvent): event is PipelineEvent<UnitCompletedPayload> {
  return event.type === 'unit:completed';
}
