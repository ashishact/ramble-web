/**
 * Program Store - TinyBase Implementation
 *
 * Unified store for all program data using TinyBase with IndexedDB persistence.
 * Implements all store interfaces with a flat table structure.
 */

import { createStore, type Store } from 'tinybase';
import { createIndexedDbPersister, type IndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';

import type {
  IProgramStore,
  ISessionStore,
  IConversationStore,
  IClaimStore,
  ISourceTrackingStore,
  IEntityStore,
  IGoalStore,
  IObserverOutputStore,
  IExtensionStore,
  ISynthesisCacheStore,
  IExtractionProgramStore,
  IObserverProgramStore,
  ICorrectionStore,
  SubscriptionCallback,
  Unsubscribe,
} from '../interfaces/store';

import type {
  Session,
  CreateSession,
  UpdateSession,
  ConversationUnit,
  CreateConversationUnit,
  UpdateConversationUnit,
  Claim,
  CreateClaim,
  UpdateClaim,
  ClaimSource,
  CreateClaimSource,
  Entity,
  CreateEntity,
  UpdateEntity,
  Goal,
  CreateGoal,
  UpdateGoal,
  ObserverOutput,
  CreateObserverOutput,
  UpdateObserverOutput,
  Contradiction,
  CreateContradiction,
  Pattern,
  CreatePattern,
  Value,
  CreateValue,
  ClaimState,
  ClaimType,
  GoalStatus,
  Task,
  CreateTask,
  UpdateTask,
  TaskStatus,
  TaskPriority,
  Extension,
  CreateExtension,
  UpdateExtension,
  ExtensionType,
  ExtensionStatus,
  SynthesisCache,
  CreateSynthesisCache,
  UpdateSynthesisCache,
  ExtractionProgram,
  CreateExtractionProgram,
  UpdateExtractionProgram,
  ObserverProgram,
  CreateObserverProgram,
  UpdateObserverProgram,
  ObserverType,
  Correction,
  CreateCorrection,
  UpdateCorrection,
  MemoryTier,
  SourceTracking,
  CreateSourceTracking,
} from '../types';

import { createLogger } from '../utils/logger';
import { id as idGen } from '../utils/id';
import { now } from '../utils/time';
import { PRIORITY_VALUES, DEFAULT_BACKOFF_CONFIG, serializeBackoffConfig } from '../schemas/task';
import { parseAliases } from '../schemas/entity';

const logger = createLogger('Store');

// ============================================================================
// Row Converters - TinyBase rows to typed objects
// ============================================================================

function rowToSession(id: string, row: Record<string, unknown>): Session {
  return {
    id,
    started_at: row.startedAt as number,
    ended_at: (row.endedAt as number) || null,
    unit_count: (row.unitCount as number) || 0,
    summary: (row.summary as string) || null,
    mood_trajectory_json: (row.moodTrajectoryJson as string) || null,
  };
}

function rowToConversationUnit(id: string, row: Record<string, unknown>): ConversationUnit {
  return {
    id,
    session_id: row.sessionId as string,
    timestamp: row.timestamp as number,
    raw_text: row.rawText as string,
    sanitized_text: row.sanitizedText as string,
    source: row.source as 'speech' | 'text',
    preceding_context_summary: row.precedingContextSummary as string,
    created_at: row.created_at as number,
    processed: row.processed as boolean,
  };
}

function rowToClaim(id: string, row: Record<string, unknown>): Claim {
  return {
    id,
    statement: row.statement as string,
    subject: row.subject as string,
    claim_type: row.claimType as ClaimType,
    temporality: row.temporality as Claim['temporality'],
    abstraction: row.abstraction as Claim['abstraction'],
    source_type: row.sourceType as Claim['source_type'],
    initial_confidence: row.initialConfidence as number,
    current_confidence: row.currentConfidence as number,
    state: row.state as ClaimState,
    emotional_valence: row.emotionalValence as number,
    emotional_intensity: row.emotionalIntensity as number,
    stakes: row.stakes as Claim['stakes'],
    valid_from: row.validFrom as number,
    valid_until: (row.validUntil as number) || null,
    created_at: row.created_at as number,
    last_confirmed: row.lastConfirmed as number,
    confirmation_count: row.confirmationCount as number,
    extraction_program_id: row.extractionProgramId as string,
    superseded_by: (row.supersededBy as string) || null,
    elaborates: (row.elaborates as string) || null,
    // Memory system fields
    memory_tier: (row.memoryTier as MemoryTier) || 'working',
    salience: (row.salience as number) || 0,
    promoted_at: (row.promotedAt as number) || null,
    last_accessed: (row.lastAccessed as number) || row.created_at as number,
  };
}

function rowToClaimSource(id: string, row: Record<string, unknown>): ClaimSource {
  return {
    id,
    claim_id: row.claimId as string,
    unit_id: row.unitId as string,
  };
}

function rowToSourceTracking(id: string, row: Record<string, unknown>): SourceTracking {
  return {
    id,
    claim_id: row.claimId as string,
    unit_id: row.unitId as string,
    unit_text: row.unitText as string,
    text_excerpt: row.textExcerpt as string,
    char_start: (row.charStart as number) || null,
    char_end: (row.charEnd as number) || null,
    pattern_id: (row.patternId as string) || null,
    llm_prompt: row.llmPrompt as string,
    llm_response: row.llmResponse as string,
    created_at: row.created_at as number,
  };
}

function rowToEntity(id: string, row: Record<string, unknown>): Entity {
  return {
    id,
    canonical_name: row.canonicalName as string,
    entity_type: row.entityType as Entity['entity_type'],
    aliases: row.aliases as string,
    created_at: row.created_at as number,
    last_referenced: row.lastReferenced as number,
    mention_count: row.mentionCount as number,
  };
}

function rowToGoal(id: string, row: Record<string, unknown>): Goal {
  return {
    id,
    statement: row.statement as string,
    goal_type: row.goal_type as Goal['goal_type'],
    timeframe: row.timeframe as Goal['timeframe'],
    status: row.status as GoalStatus,
    parent_goal_id: (row.parentGoalId as string) || null,
    created_at: row.created_at as number,
    last_referenced: row.lastReferenced as number,
    priority: row.priority as number,
    progress_type: row.progressType as Goal['progress_type'],
    progress_value: row.progress_value as number,
    progress_indicators_json: row.progressIndicatorsJson as string,
    blockers_json: row.blockersJson as string,
    source_claim_id: row.sourceClaimId as string,
    motivation: (row.motivation as string) || null,
    deadline: (row.deadline as number) || null,
  };
}

function rowToObserverOutput(id: string, row: Record<string, unknown>): ObserverOutput {
  return {
    id,
    observer_type: row.observer_type as ObserverOutput['observer_type'],
    output_type: row.output_type as string,
    content_json: row.contentJson as string,
    source_claims_json: row.source_claims_json as string,
    created_at: row.created_at as number,
    stale: row.stale as boolean,
  };
}

function rowToContradiction(id: string, row: Record<string, unknown>): Contradiction {
  return {
    id,
    claim_a_id: row.claimAId as string,
    claim_b_id: row.claimBId as string,
    detected_at: row.detectedAt as number,
    contradiction_type: row.contradictionType as Contradiction['contradiction_type'],
    resolved: row.resolved as boolean,
    resolution_type: (row.resolutionType as string) || null,
    resolution_notes: (row.resolutionNotes as string) || null,
    resolved_at: (row.resolvedAt as number) || null,
  };
}

function rowToPattern(id: string, row: Record<string, unknown>): Pattern {
  return {
    id,
    pattern_type: row.pattern_type as string,
    description: row.description as string,
    evidence_claims_json: row.evidenceClaimsJson as string,
    first_detected: row.firstDetected as number,
    last_detected: row.lastDetected as number,
    occurrence_count: row.occurrenceCount as number,
    confidence: row.confidence as number,
  };
}

function rowToValue(id: string, row: Record<string, unknown>): Value {
  return {
    id,
    statement: row.statement as string,
    domain: row.domain as string,
    importance: row.importance as number,
    source_claim_id: row.sourceClaimId as string,
    first_expressed: row.firstExpressed as number,
    last_confirmed: row.lastConfirmed as number,
    confirmation_count: row.confirmationCount as number,
  };
}

function rowToTask(id: string, row: Record<string, unknown>): Task {
  return {
    id,
    task_type: row.taskType as Task['task_type'],
    payload_json: row.payloadJson as string,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    priority_value: row.priority_value as number,
    attempts: row.attempts as number,
    max_attempts: row.maxAttempts as number,
    last_error: (row.lastError as string) || null,
    last_error_at: (row.lastErrorAt as number) || null,
    next_retry_at: (row.next_retry_at as number) || null,
    backoff_config_json: row.backoffConfigJson as string,
    checkpoint_json: (row.checkpointJson as string) || null,
    created_at: row.created_at as number,
    started_at: (row.startedAt as number) || null,
    completed_at: (row.completedAt as number) || null,
    execute_at: row.executeAt as number,
    group_id: (row.groupId as string) || null,
    depends_on: (row.dependsOn as string) || null,
    session_id: (row.sessionId as string) || null,
  };
}

function rowToExtension(id: string, row: Record<string, unknown>): Extension {
  return {
    id,
    extension_type: row.extensionType as ExtensionType,
    name: row.name as string,
    description: row.description as string,
    config_json: row.configJson as string,
    system_prompt: row.systemPrompt as string,
    user_prompt_template: row.userPromptTemplate as string,
    variables_schema_json: row.variablesSchemaJson as string,
    status: row.status as ExtensionStatus,
    version: row.version as number,
    created_at: row.created_at as number,
    verified_at: (row.verifiedAt as number) || null,
  };
}

function rowToSynthesisCache(id: string, row: Record<string, unknown>): SynthesisCache {
  return {
    id,
    synthesis_type: row.synthesis_type as string,
    cache_key: row.cacheKey as string,
    content_json: row.contentJson as string,
    source_claims_json: row.source_claims_json as string,
    generated_at: row.generatedAt as number,
    stale: row.stale as boolean,
    ttl_seconds: row.ttl_seconds as number,
  };
}

function rowToExtractionProgram(id: string, row: Record<string, unknown>): ExtractionProgram {
  return {
    id,
    name: row.name as string,
    description: row.description as string,
    type: row.type as string,
    version: row.version as number,
    patterns_json: row.patternsJson as string,
    always_run: row.alwaysRun as boolean,
    llm_tier: row.llmTier as 'small' | 'medium' | 'large',
    llm_temperature: (row.llmTemperature as number) === 0 ? null : (row.llmTemperature as number),
    llm_max_tokens: (row.llmMaxTokens as number) === 0 ? null : (row.llmMaxTokens as number),
    prompt_template: row.promptTemplate as string,
    output_schema_json: row.outputSchemaJson as string,
    priority: row.priority as number,
    active: row.active as boolean,
    min_confidence: row.minConfidence as number,
    is_core: row.isCore as boolean,
    claim_types_json: row.claimTypesJson as string,
    success_rate: row.successRate as number,
    run_count: row.runCount as number,
    avg_processing_time_ms: row.avgProcessingTimeMs as number,
    created_at: row.created_at as number,
    updated_at: row.updatedAt as number,
  };
}

function rowToObserverProgram(id: string, row: Record<string, unknown>): ObserverProgram {
  return {
    id,
    name: row.name as string,
    type: row.type as ObserverType,
    description: row.description as string,
    active: row.active as boolean,
    priority: row.priority as number,
    triggers: JSON.parse(row.triggers as string),
    claim_type_filter: (row.claimTypeFilter as string) || null,
    uses_llm: row.usesLlm as boolean,
    llm_tier: (row.llmTier as 'small' | 'medium' | 'large') || null,
    llm_temperature: (row.llmTemperature as number) === 0 ? null : (row.llmTemperature as number),
    llm_max_tokens: (row.llmMaxTokens as number) === 0 ? null : (row.llmMaxTokens as number),
    prompt_template: (row.promptTemplate as string) || null,
    output_schema_json: (row.outputSchemaJson as string) || null,
    should_run_logic: (row.shouldRunLogic as string) || null,
    process_logic: (row.process_logic as string) || null,
    is_core: row.isCore as boolean,
    version: row.version as number,
    created_at: row.created_at as number,
    updated_at: row.updatedAt as number,
    run_count: row.runCount as number,
    success_rate: row.successRate as number,
    avg_processing_time_ms: row.avgProcessingTimeMs as number,
  };
}

function rowToCorrection(id: string, row: Record<string, unknown>): Correction {
  return {
    id,
    wrongText: row.wrongText as string,
    correctText: row.correctText as string,
    originalCase: row.originalCase as string,
    usage_count: row.usageCount as number,
    created_at: row.created_at as number,
    last_used: row.lastUsed as number,
    source_unit_id: (row.sourceUnitId as string) || null,
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export interface ProgramStoreInstance extends IProgramStore {
  tasks: ITaskStore;
  corrections: ICorrectionStore;
  patterns: { getAll(): Pattern[] };
  getStore(): Store;
}

export interface ITaskStore {
  getById(id: string): Task | null;
  getAll(): Task[];
  count(): number;
  create(data: CreateTask): Task;
  update(id: string, data: UpdateTask): Task | null;
  delete(id: string): boolean;
  getByStatus(status: TaskStatus): Task[];
  getPending(): Task[];
  getRetryable(): Task[];
  getBySession(sessionId: string): Task[];
  subscribe(callback: SubscriptionCallback<Task>): Unsubscribe;
}

export function createProgramStore(): ProgramStoreInstance {
  let store: Store;
  let persister: IndexedDbPersister;
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;

  // Listener management
  const sessionListeners = new Set<SubscriptionCallback<Session>>();
  const conversationListeners = new Map<string, Set<SubscriptionCallback<ConversationUnit>>>();
  const claimListeners = new Map<string, Set<SubscriptionCallback<Claim>>>();
  const entityListeners = new Set<SubscriptionCallback<Entity>>();
  const goalListeners = new Set<SubscriptionCallback<Goal>>();
  const observerOutputListeners = new Set<SubscriptionCallback<ObserverOutput>>();
  const taskListeners = new Set<SubscriptionCallback<Task>>();

  // Notify helpers
  const notifySessionListeners = () => {
    const items = sessions.getAll();
    sessionListeners.forEach((l) => l(items));
  };
  const notifyEntityListeners = () => {
    const items = entities.getAll();
    entityListeners.forEach((l) => l(items));
  };
  const notifyGoalListeners = () => {
    const items = goals.getAll();
    goalListeners.forEach((l) => l(items));
  };
  const notifyObserverOutputListeners = () => {
    const items = observerOutputs.getAll();
    observerOutputListeners.forEach((l) => l(items));
  };
  const notifyTaskListeners = () => {
    const items = tasks.getAll();
    taskListeners.forEach((l) => l(items));
  };

  // --------------------------------------------------------------------------
  // Sessions Store
  // --------------------------------------------------------------------------
  const sessions: ISessionStore = {
    getById(id: string): Session | null {
      const row = store.getRow('sessions', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToSession(id, row);
    },

    getAll(): Session[] {
      const table = store.getTable('sessions');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToSession(id, row));
    },

    count(): number {
      const table = store.getTable('sessions');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateSession): Session {
      const id = idGen.session();
      const timestamp = now();
      const session: Session = {
        id,
        started_at: data.startedAt ?? timestamp,
        ended_at: data.endedAt ?? null,
        unit_count: data.unitCount ?? 0,
        summary: data.summary ?? null,
        mood_trajectory_json: data.moodTrajectoryJson ?? null,
      };

      store.setRow('sessions', id, {
        started_at: session.startedAt,
        ended_at: session.endedAt ?? 0,
        unit_count: session.unitCount,
        summary: session.summary ?? '',
        mood_trajectory_json: session.moodTrajectoryJson ?? '',
      });

      logger.debug('Created session', { id });
      return session;
    },

    update(id: string, data: UpdateSession): Session | null {
      const existing = sessions.getById(id);
      if (!existing) return null;

      if (data.startedAt !== undefined) store.setCell('sessions', id, 'started_at', data.startedAt);
      if (data.endedAt !== undefined) store.setCell('sessions', id, 'ended_at', data.endedAt ?? 0);
      if (data.unitCount !== undefined) store.setCell('sessions', id, 'unit_count', data.unitCount);
      if (data.summary !== undefined) store.setCell('sessions', id, 'summary', data.summary ?? '');
      if (data.moodTrajectoryJson !== undefined)
        store.setCell('sessions', id, 'mood_trajectory_json', data.moodTrajectoryJson ?? '');

      return sessions.getById(id);
    },

    delete(id: string): boolean {
      const existing = sessions.getById(id);
      if (!existing) return false;
      store.delRow('sessions', id);
      return true;
    },

    getActive(): Session | null {
      const all = sessions.getAll();
      return all.find((s) => s.endedAt === null) ?? null;
    },

    endSession(id: string): Session | null {
      return sessions.update(id, { ended_at: now() });
    },

    incrementUnitCount(id: string): void {
      const session = sessions.getById(id);
      if (session) {
        sessions.update(id, { unit_count: session.unitCount + 1 });
      }
    },

    subscribe(callback: SubscriptionCallback<Session>): Unsubscribe {
      sessionListeners.add(callback);
      if (isInitialized) callback(sessions.getAll());
      return () => sessionListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Conversations Store
  // --------------------------------------------------------------------------
  const conversations: IConversationStore = {
    getById(id: string): ConversationUnit | null {
      const row = store.getRow('conversations', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToConversationUnit(id, row);
    },

    getAll(): ConversationUnit[] {
      const table = store.getTable('conversations');
      if (!table) return [];
      return Object.entries(table)
        .map(([id, row]) => rowToConversationUnit(id, row))
        .sort((a, b) => a.timestamp - b.timestamp);
    },

    count(): number {
      const table = store.getTable('conversations');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateConversationUnit): ConversationUnit {
      const id = idGen.conversationUnit();
      const timestamp = now();
      const unit: ConversationUnit = {
        id,
        session_id: data.sessionId,
        timestamp: data.timestamp,
        raw_text: data.rawText,
        sanitized_text: data.sanitizedText,
        source: data.source,
        preceding_context_summary: data.precedingContextSummary,
        created_at: timestamp,
        processed: data.processed ?? false,
      };

      store.setRow('conversations', id, {
        session_id: unit.sessionId,
        timestamp: unit.timestamp,
        raw_text: unit.rawText,
        sanitized_text: unit.sanitizedText,
        source: unit.source,
        preceding_context_summary: unit.precedingContextSummary,
        created_at: unit.created_at,
        processed: unit.processed,
      });

      logger.debug('Created conversation unit', { id });
      return unit;
    },

    update(id: string, data: UpdateConversationUnit): ConversationUnit | null {
      const existing = conversations.getById(id);
      if (!existing) return null;

      if (data.processed !== undefined) store.setCell('conversations', id, 'processed', data.processed);

      return conversations.getById(id);
    },

    delete(id: string): boolean {
      const existing = conversations.getById(id);
      if (!existing) return false;
      store.delRow('conversations', id);
      return true;
    },

    getBySession(sessionId: string): ConversationUnit[] {
      return conversations.getAll().filter((c) => c.sessionId === sessionId);
    },

    getUnprocessed(): ConversationUnit[] {
      return conversations.getAll().filter((c) => !c.processed);
    },

    markProcessed(id: string): void {
      conversations.update(id, { processed: true });
    },

    getRecent(limit: number): ConversationUnit[] {
      return conversations.getAll().slice(-limit);
    },

    subscribe(sessionId: string, callback: SubscriptionCallback<ConversationUnit>): Unsubscribe {
      if (!conversationListeners.has(sessionId)) {
        conversationListeners.set(sessionId, new Set());
      }
      conversationListeners.get(sessionId)!.add(callback);
      if (isInitialized) callback(conversations.getBySession(sessionId));
      return () => conversationListeners.get(sessionId)?.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Claims Store
  // --------------------------------------------------------------------------
  const claims: IClaimStore = {
    getById(id: string): Claim | null {
      const row = store.getRow('claims', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToClaim(id, row);
    },

    getAll(): Claim[] {
      const table = store.getTable('claims');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToClaim(id, row));
    },

    count(): number {
      const table = store.getTable('claims');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateClaim): Claim {
      const id = idGen.claim();
      const timestamp = now();
      const claim: Claim = {
        id,
        statement: data.statement,
        subject: data.subject,
        claim_type: data.claimType,
        temporality: data.temporality,
        abstraction: data.abstraction,
        source_type: data.sourceType,
        initial_confidence: data.initialConfidence,
        current_confidence: data.initialConfidence,
        state: data.state ?? 'active',
        emotional_valence: data.emotionalValence,
        emotional_intensity: data.emotionalIntensity,
        stakes: data.stakes,
        valid_from: data.validFrom,
        valid_until: data.validUntil,
        created_at: timestamp,
        last_confirmed: timestamp,
        confirmation_count: data.confirmationCount ?? 1,
        extraction_program_id: data.extractionProgramId,
        superseded_by: data.supersededBy ?? null,
        elaborates: data.elaborates,
        // Memory system fields
        memory_tier: data.memoryTier ?? 'working',
        salience: data.salience ?? 0,
        promoted_at: data.promotedAt ?? null,
        last_accessed: timestamp,
      };

      store.setRow('claims', id, {
        statement: claim.statement,
        subject: claim.subject,
        claim_type: claim.claimType,
        temporality: claim.temporality,
        abstraction: claim.abstraction,
        source_type: claim.sourceType,
        initial_confidence: claim.initialConfidence,
        current_confidence: claim.currentConfidence,
        state: claim.state,
        emotional_valence: claim.emotionalValence,
        emotional_intensity: claim.emotionalIntensity,
        stakes: claim.stakes,
        valid_from: claim.validFrom,
        valid_until: claim.validUntil ?? 0,
        created_at: claim.created_at,
        last_confirmed: claim.lastConfirmed,
        confirmation_count: claim.confirmationCount,
        extraction_program_id: claim.extractionProgramId,
        superseded_by: claim.supersededBy ?? '',
        elaborates: claim.elaborates ?? '',
        // Memory system fields
        memory_tier: claim.memoryTier,
        salience: claim.salience,
        promoted_at: claim.promotedAt ?? 0,
        last_accessed: claim.lastAccessed,
      });

      logger.debug('Created claim', { id, type: claim.claimType });
      return claim;
    },

    update(id: string, data: UpdateClaim): Claim | null {
      const existing = claims.getById(id);
      if (!existing) return null;

      const row = store.getRow('claims', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('claims', id, key, storeValue);
        }
      }

      return claims.getById(id);
    },

    delete(id: string): boolean {
      const existing = claims.getById(id);
      if (!existing) return false;
      store.delRow('claims', id);
      return true;
    },

    getByState(state: ClaimState): Claim[] {
      return claims.getAll().filter((c) => c.state === state);
    },

    getByType(type: ClaimType): Claim[] {
      return claims.getAll().filter((c) => c.claimType === type);
    },

    getBySubject(subject: string): Claim[] {
      return claims.getAll().filter((c) => c.subject === subject);
    },

    getBySession(sessionId: string): Claim[] {
      // Get all claim sources for units in this session
      const sessionUnits = conversations.getBySession(sessionId);
      const unitIds = new Set(sessionUnits.map((u) => u.id));
      const sources = claims.getSourcesForUnit('').filter((s) => unitIds.has(s.unitId));
      const claimIds = new Set(sources.map((s) => s.claimId));
      return claims.getAll().filter((c) => claimIds.has(c.id));
    },

    getRecent(limit: number): Claim[] {
      return claims
        .getAll()
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);
    },

    confirmClaim(id: string): void {
      const claim = claims.getById(id);
      if (claim) {
        claims.update(id, {
          last_confirmed: now(),
          confirmation_count: claim.confirmationCount + 1,
        });
      }
    },

    supersedeClaim(id: string, newClaimId: string): void {
      claims.update(id, { state: 'superseded', superseded_by: newClaimId });
    },

    decayConfidence(id: string, factor: number): void {
      const claim = claims.getById(id);
      if (claim) {
        claims.update(id, { current_confidence: claim.currentConfidence * factor });
      }
    },

    subscribe(sessionId: string, callback: SubscriptionCallback<Claim>): Unsubscribe {
      if (!claimListeners.has(sessionId)) {
        claimListeners.set(sessionId, new Set());
      }
      claimListeners.get(sessionId)!.add(callback);
      if (isInitialized) callback(claims.getBySession(sessionId));
      return () => claimListeners.get(sessionId)?.delete(callback);
    },

    addSource(data: CreateClaimSource): ClaimSource {
      const id = idGen.claimSource();
      const source: ClaimSource = { id, ...data };

      store.setRow('claim_sources', id, {
        claim_id: source.claimId,
        unit_id: source.unitId,
      });

      return source;
    },

    getSourcesForClaim(claimId: string): ClaimSource[] {
      const table = store.getTable('claim_sources');
      if (!table) return [];
      return Object.entries(table)
        .filter(([, row]) => row.claimId === claimId)
        .map(([id, row]) => rowToClaimSource(id, row));
    },

    getSourcesForUnit(unitId: string): ClaimSource[] {
      const table = store.getTable('claim_sources');
      if (!table) return [];
      if (!unitId) {
        // Return all sources
        return Object.entries(table).map(([id, row]) => rowToClaimSource(id, row));
      }
      return Object.entries(table)
        .filter(([, row]) => row.unitId === unitId)
        .map(([id, row]) => rowToClaimSource(id, row));
    },

    // Memory system methods
    getByMemoryTier(tier: MemoryTier): Claim[] {
      return claims.getAll().filter((c) => c.memoryTier === tier);
    },

    getDecayable(): Claim[] {
      return claims.getAll().filter((c) => c.temporality !== 'eternal' && c.state === 'active');
    },

    updateSalience(id: string, salience: number): void {
      const claim = claims.getById(id);
      if (claim) {
        claims.update(id, { salience: Math.max(0, Math.min(1, salience)) });
      }
    },

    updateLastAccessed(id: string): void {
      const claim = claims.getById(id);
      if (claim) {
        claims.update(id, { last_accessed: now() });
      }
    },

    promoteToLongTerm(id: string): void {
      const claim = claims.getById(id);
      if (claim && claim.memoryTier === 'working') {
        claims.update(id, {
          memory_tier: 'long_term',
          promoted_at: now(),
        });
        logger.info('Promoted claim to long-term memory', { id });
      }
    },

    markStale(id: string): void {
      const claim = claims.getById(id);
      if (claim && claim.state === 'active') {
        claims.update(id, { state: 'stale' });
        logger.debug('Marked claim as stale', { id });
      }
    },

    markDormant(id: string): void {
      const claim = claims.getById(id);
      if (claim && (claim.state === 'active' || claim.state === 'stale')) {
        claims.update(id, { state: 'dormant' });
        logger.debug('Marked claim as dormant', { id });
      }
    },
  };

  // --------------------------------------------------------------------------
  // Source Tracking Store
  // --------------------------------------------------------------------------
  const sourceTracking: ISourceTrackingStore = {
    getById(id: string): SourceTracking | null {
      const row = store.getRow('source_tracking', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToSourceTracking(id, row);
    },

    getAll(): SourceTracking[] {
      const table = store.getTable('source_tracking');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToSourceTracking(id, row));
    },

    count(): number {
      const table = store.getTable('source_tracking');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateSourceTracking): SourceTracking {
      const id = idGen.claim(); // Reuse claim ID generator
      const timestamp = now();
      const tracking: SourceTracking = {
        id,
        ...data,
        created_at: timestamp,
      };

      store.setRow('source_tracking', id, {
        claim_id: tracking.claimId,
        unit_id: tracking.unitId,
        unit_text: tracking.unitText,
        text_excerpt: tracking.textExcerpt,
        char_start: tracking.charStart ?? 0,
        char_end: tracking.charEnd ?? 0,
        pattern_id: tracking.patternId ?? '',
        llm_prompt: tracking.llmPrompt,
        llm_response: tracking.llmResponse,
        created_at: tracking.created_at,
      });

      logger.debug('Created source tracking', { id, claimId: tracking.claimId });
      return tracking;
    },

    update() {
      // Source tracking is immutable - no updates allowed
      throw new Error('Source tracking cannot be updated');
    },

    delete(id: string): boolean {
      const existing = sourceTracking.getById(id);
      if (!existing) return false;
      store.delRow('source_tracking', id);
      return true;
    },

    getByClaimId(claimId: string): SourceTracking | null {
      const table = store.getTable('source_tracking');
      if (!table) return null;
      const entry = Object.entries(table).find(([, row]) => row.claimId === claimId);
      return entry ? rowToSourceTracking(entry[0], entry[1]) : null;
    },

    getByUnitId(unitId: string): SourceTracking[] {
      const table = store.getTable('source_tracking');
      if (!table) return [];
      return Object.entries(table)
        .filter(([, row]) => row.unitId === unitId)
        .map(([id, row]) => rowToSourceTracking(id, row));
    },

    deleteByClaimId(claimId: string): boolean {
      const tracking = sourceTracking.getByClaimId(claimId);
      if (!tracking) return false;
      return sourceTracking.delete(tracking.id);
    },
  };

  // --------------------------------------------------------------------------
  // Entities Store
  // --------------------------------------------------------------------------
  const entities: IEntityStore = {
    getById(id: string): Entity | null {
      const row = store.getRow('entities', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToEntity(id, row);
    },

    getAll(): Entity[] {
      const table = store.getTable('entities');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToEntity(id, row));
    },

    count(): number {
      const table = store.getTable('entities');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateEntity): Entity {
      const id = idGen.entity();
      const timestamp = now();
      // Normalize canonical name: trim whitespace and use proper casing
      const canonicalName = data.canonicalName.trim();

      const entity: Entity = {
        id,
        canonical_name: canonicalName,
        entity_type: data.entityType,
        aliases: data.aliases,
        created_at: timestamp,
        last_referenced: timestamp,
        mention_count: data.mentionCount ?? 1,
      };

      store.setRow('entities', id, {
        canonical_name: entity.canonicalName,
        entity_type: entity.entityType,
        aliases: entity.aliases,
        created_at: entity.created_at,
        last_referenced: entity.lastReferenced,
        mention_count: entity.mentionCount,
      });

      logger.debug('Created entity', { id, name: entity.canonicalName });
      return entity;
    },

    update(id: string, data: UpdateEntity): Entity | null {
      const existing = entities.getById(id);
      if (!existing) return null;

      const row = store.getRow('entities', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('entities', id, key, storeValue);
        }
      }

      return entities.getById(id);
    },

    delete(id: string): boolean {
      const existing = entities.getById(id);
      if (!existing) return false;
      store.delRow('entities', id);
      return true;
    },

    getByName(name: string): Entity | null {
      const normalizedName = name.trim().toLowerCase();
      return entities.getAll().find((e) => e.canonicalName.trim().toLowerCase() === normalizedName) ?? null;
    },

    getByType(type: string): Entity[] {
      return entities.getAll().filter((e) => e.entityType === type);
    },

    findByAlias(alias: string): Entity | null {
      const normalizedAlias = alias.trim().toLowerCase();
      return (
        entities.getAll().find((e) => {
          const aliases = parseAliases(e.aliases).map(a => a.trim().toLowerCase());
          const canonicalName = e.canonicalName.trim().toLowerCase();
          return aliases.includes(normalizedAlias) || canonicalName === normalizedAlias;
        }) ?? null
      );
    },

    incrementMentionCount(id: string): void {
      const entity = entities.getById(id);
      if (entity) {
        entities.update(id, { mention_count: entity.mentionCount + 1 });
      }
    },

    updateLastReferenced(id: string): void {
      entities.update(id, { last_referenced: now() });
    },

    mergeEntities(keepId: string, deleteId: string): Entity | null {
      const keepEntity = entities.getById(keepId);
      const deleteEntity = entities.getById(deleteId);

      if (!keepEntity || !deleteEntity) {
        logger.error('Cannot merge entities - one or both not found', { keepId, deleteId });
        return null;
      }

      // Merge aliases
      const keepAliases = parseAliases(keepEntity.aliases);
      const deleteAliases = parseAliases(deleteEntity.aliases);
      const mergedAliases = [...new Set([...keepAliases, ...deleteAliases, deleteEntity.canonicalName])];

      // Update the entity we're keeping
      entities.update(keepId, {
        aliases: JSON.stringify(mergedAliases),
        mention_count: keepEntity.mentionCount + deleteEntity.mentionCount,
        last_referenced: Math.max(keepEntity.lastReferenced, deleteEntity.lastReferenced),
      });

      // Delete the duplicate entity
      entities.delete(deleteId);

      logger.info('Merged entities', {
        kept: { id: keepId, name: keepEntity.canonicalName },
        deleted: { id: deleteId, name: deleteEntity.canonicalName },
        newMentionCount: keepEntity.mentionCount + deleteEntity.mentionCount,
      });

      return entities.getById(keepId);
    },

    subscribe(callback: SubscriptionCallback<Entity>): Unsubscribe {
      entityListeners.add(callback);
      if (isInitialized) callback(entities.getAll());
      return () => entityListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Goals Store
  // --------------------------------------------------------------------------
  const goals: IGoalStore = {
    getById(id: string): Goal | null {
      const row = store.getRow('goals', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToGoal(id, row);
    },

    getAll(): Goal[] {
      const table = store.getTable('goals');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToGoal(id, row));
    },
    count(): number {
      const table = store.getTable('goals');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateGoal): Goal {
      const id = idGen.goal();
      const timestamp = now();
      const goal: Goal = {
        id,
        statement: data.statement,
        goal_type: data.goal_type,
        timeframe: data.timeframe,
        status: data.status ?? 'active',
        parent_goal_id: data.parentGoalId,
        created_at: timestamp,
        last_referenced: timestamp,
        priority: data.priority,
        progress_type: data.progressType,
        progress_value: data.progress_value ?? 0,
        progress_indicators_json: data.progressIndicatorsJson ?? '[]',
        blockers_json: data.blockersJson ?? '[]',
        source_claim_id: data.sourceClaimId,
        motivation: data.motivation,
        deadline: data.deadline,
      };

      store.setRow('goals', id, {
        statement: goal.statement,
        goal_type: goal.goal_type,
        timeframe: goal.timeframe,
        status: goal.status,
        parent_goal_id: goal.parentGoalId ?? '',
        created_at: goal.created_at,
        last_referenced: goal.lastReferenced,
        priority: goal.priority,
        progress_type: goal.progressType,
        progress_value: goal.progress_value,
        progress_indicators_json: goal.progressIndicatorsJson,
        blockers_json: goal.blockersJson,
        source_claim_id: goal.sourceClaimId,
        motivation: goal.motivation ?? '',
        deadline: goal.deadline ?? 0,
      });

      logger.debug('Created goal', { id, statement: goal.statement });
      return goal;
    },

    update(id: string, data: UpdateGoal): Goal | null {
      const existing = goals.getById(id);
      if (!existing) return null;

      const row = store.getRow('goals', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('goals', id, key, storeValue);
        }
      }

      return goals.getById(id);
    },

    delete(id: string): boolean {
      const existing = goals.getById(id);
      if (!existing) return false;
      store.delRow('goals', id);
      return true;
    },

    getByStatus(status: GoalStatus): Goal[] {
      return goals.getAll().filter((g) => g.status === status);
    },

    getActive(): Goal[] {
      return goals.getByStatus('active');
    },

    getByParent(parentId: string | null): Goal[] {
      if (parentId === null) {
        return goals.getAll().filter((g) => !g.parentGoalId);
      }
      return goals.getAll().filter((g) => g.parentGoalId === parentId);
    },

    getRoots(): Goal[] {
      return goals.getByParent(null);
    },

    getChildren(goalId: string): Goal[] {
      return goals.getByParent(goalId);
    },

    updateProgress(id: string, value: number): void {
      goals.update(id, { progress_value: value, last_referenced: now() });
    },

    updateStatus(id: string, status: GoalStatus): void {
      goals.update(id, { status, last_referenced: now() });
    },

    updateLastReferenced(id: string): void {
      goals.update(id, { last_referenced: now() });
    },

    subscribe(callback: SubscriptionCallback<Goal>): Unsubscribe {
      goalListeners.add(callback);
      if (isInitialized) callback(goals.getAll());
      return () => goalListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Observer Outputs Store
  // --------------------------------------------------------------------------
  const observerOutputs: IObserverOutputStore = {
    getById(id: string): ObserverOutput | null {
      const row = store.getRow('observer_outputs', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToObserverOutput(id, row);
    },

    getAll(): ObserverOutput[] {
      const table = store.getTable('observer_outputs');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToObserverOutput(id, row));
    },
    count(): number {
      const table = store.getTable('observer_outputs');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateObserverOutput): ObserverOutput {
      const id = idGen.observerOutput();
      const timestamp = now();
      const output: ObserverOutput = {
        id,
        observer_type: data.observer_type,
        output_type: data.output_type,
        content_json: data.contentJson,
        source_claims_json: data.source_claims_json,
        created_at: timestamp,
        stale: data.stale ?? false,
      };

      store.setRow('observer_outputs', id, {
        observer_type: output.observer_type,
        output_type: output.output_type,
        content_json: output.contentJson,
        source_claims_json: output.source_claims_json,
        created_at: output.created_at,
        stale: output.stale,
      });

      logger.debug('Created observer output', { id, type: output.output_type });
      return output;
    },

    update(id: string, data: UpdateObserverOutput): ObserverOutput | null {
      const existing = observerOutputs.getById(id);
      if (!existing) return null;

      if (data.observer_type !== undefined) store.setCell('observer_outputs', id, 'observer_type', data.observer_type);
      if (data.output_type !== undefined) store.setCell('observer_outputs', id, 'output_type', data.output_type);
      if (data.contentJson !== undefined) store.setCell('observer_outputs', id, 'content_json', data.contentJson);
      if (data.source_claims_json !== undefined)
        store.setCell('observer_outputs', id, 'source_claims_json', data.source_claims_json);
      if (data.stale !== undefined) store.setCell('observer_outputs', id, 'stale', data.stale);

      return observerOutputs.getById(id);
    },

    delete(id: string): boolean {
      const existing = observerOutputs.getById(id);
      if (!existing) return false;
      store.delRow('observer_outputs', id);
      return true;
    },

    getByType(type: string): ObserverOutput[] {
      return observerOutputs.getAll().filter((o) => o.output_type === type);
    },

    getRecent(limit: number): ObserverOutput[] {
      return observerOutputs
        .getAll()
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);
    },

    markStale(id: string): void {
      observerOutputs.update(id, { stale: true });
    },

    subscribe(callback: SubscriptionCallback<ObserverOutput>): Unsubscribe {
      observerOutputListeners.add(callback);
      if (isInitialized) callback(observerOutputs.getAll());
      return () => observerOutputListeners.delete(callback);
    },

    addContradiction(data: CreateContradiction): Contradiction {
      const id = idGen.contradiction();
      const timestamp = now();
      const contradiction: Contradiction = {
        id,
        claim_a_id: data.claimAId,
        claim_b_id: data.claimBId,
        detected_at: timestamp,
        contradiction_type: data.contradictionType,
        resolved: data.resolved ?? false,
        resolution_type: data.resolutionType ?? null,
        resolution_notes: data.resolutionNotes ?? null,
        resolved_at: data.resolvedAt ?? null,
      };

      store.setRow('contradictions', id, {
        claim_a_id: contradiction.claimAId,
        claim_b_id: contradiction.claimBId,
        detected_at: contradiction.detectedAt,
        contradiction_type: contradiction.contradictionType,
        resolved: contradiction.resolved,
        resolution_type: contradiction.resolutionType ?? '',
        resolution_notes: contradiction.resolutionNotes ?? '',
        resolved_at: contradiction.resolvedAt ?? 0,
      });

      return contradiction;
    },

    getContradictions(): Contradiction[] {
      const table = store.getTable('contradictions');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToContradiction(id, row));
    },

    getUnresolvedContradictions(): Contradiction[] {
      return observerOutputs.getContradictions().filter((c) => !c.resolved);
    },

    resolveContradiction(id: string, resolutionType: string, notes: string | null): Contradiction | null {
      const timestamp = now();
      store.setCell('contradictions', id, 'resolved', true);
      store.setCell('contradictions', id, 'resolution_type', resolutionType);
      store.setCell('contradictions', id, 'resolution_notes', notes ?? '');
      store.setCell('contradictions', id, 'resolved_at', timestamp);

      const row = store.getRow('contradictions', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToContradiction(id, row);
    },

    addPattern(data: CreatePattern): Pattern {
      const id = idGen.pattern();
      const timestamp = now();
      const pattern: Pattern = {
        id,
        pattern_type: data.pattern_type,
        description: data.description,
        evidence_claims_json: data.evidenceClaimsJson,
        first_detected: timestamp,
        last_detected: timestamp,
        occurrence_count: data.occurrenceCount ?? 1,
        confidence: data.confidence,
      };

      store.setRow('patterns', id, {
        pattern_type: pattern.pattern_type,
        description: pattern.description,
        evidence_claims_json: pattern.evidenceClaimsJson,
        first_detected: pattern.firstDetected,
        last_detected: pattern.lastDetected,
        occurrence_count: pattern.occurrenceCount,
        confidence: pattern.confidence,
      });

      return pattern;
    },

    getPatterns(): Pattern[] {
      const table = store.getTable('patterns');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToPattern(id, row));
    },

    reinforcePattern(id: string): void {
      const pattern = observerOutputs.getPatterns().find((p) => p.id === id);
      if (pattern) {
        store.setCell('patterns', id, 'last_detected', now());
        store.setCell('patterns', id, 'occurrence_count', pattern.occurrenceCount + 1);
      }
    },

    addValue(data: CreateValue): Value {
      const id = idGen.value();
      const timestamp = now();
      const value: Value = {
        id,
        statement: data.statement,
        domain: data.domain,
        importance: data.importance,
        source_claim_id: data.sourceClaimId,
        first_expressed: timestamp,
        last_confirmed: timestamp,
        confirmation_count: data.confirmationCount ?? 1,
      };

      store.setRow('values', id, {
        statement: value.statement,
        domain: value.domain,
        importance: value.importance,
        source_claim_id: value.sourceClaimId,
        first_expressed: value.firstExpressed,
        last_confirmed: value.lastConfirmed,
        confirmation_count: value.confirmationCount,
      });

      return value;
    },

    getValues(): Value[] {
      const table = store.getTable('values');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToValue(id, row));
    },

    confirmValue(id: string): void {
      const value = observerOutputs.getValues().find((v) => v.id === id);
      if (value) {
        store.setCell('values', id, 'last_confirmed', now());
        store.setCell('values', id, 'confirmation_count', value.confirmationCount + 1);
      }
    },
  };

  // --------------------------------------------------------------------------
  // Tasks Store
  // --------------------------------------------------------------------------
  const tasks: ITaskStore = {
    getById(id: string): Task | null {
      const row = store.getRow('tasks', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToTask(id, row);
    },

    getAll(): Task[] {
      const table = store.getTable('tasks');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToTask(id, row));
    },
    count(): number {
      const table = store.getTable('tasks');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateTask): Task {
      const id = idGen.task();
      const timestamp = now();
      const priority = data.priority ?? 'normal';
      const task: Task = {
        id,
        task_type: data.taskType,
        payload_json: data.payloadJson,
        status: 'pending',
        priority,
        priority_value: PRIORITY_VALUES[priority],
        attempts: 0,
        max_attempts: data.maxAttempts ?? 5,
        last_error: null,
        last_error_at: null,
        next_retry_at: null,
        backoff_config_json: data.backoffConfigJson ?? serializeBackoffConfig(DEFAULT_BACKOFF_CONFIG),
        checkpoint_json: null,
        created_at: timestamp,
        started_at: null,
        completed_at: null,
        execute_at: data.executeAt ?? timestamp,
        group_id: data.groupId ?? null,
        depends_on: data.dependsOn ?? null,
        session_id: data.sessionId ?? null,
      };

      store.setRow('tasks', id, {
        task_type: task.taskType,
        payload_json: task.payloadJson,
        status: task.status,
        priority: task.priority,
        priority_value: task.priority_value,
        attempts: task.attempts,
        max_attempts: task.maxAttempts,
        last_error: '',
        last_error_at: 0,
        next_retry_at: 0,
        backoff_config_json: task.backoffConfigJson,
        checkpoint_json: '',
        created_at: task.created_at,
        started_at: 0,
        completed_at: 0,
        execute_at: task.executeAt,
        group_id: task.groupId ?? '',
        depends_on: task.dependsOn ?? '',
        session_id: task.sessionId ?? '',
      });

      logger.debug('Created task', { id, type: task.taskType });
      return task;
    },

    update(id: string, data: UpdateTask): Task | null {
      const existing = tasks.getById(id);
      if (!existing) return null;

      const row = store.getRow('tasks', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('tasks', id, key, storeValue);
        }
      }

      return tasks.getById(id);
    },

    delete(id: string): boolean {
      const existing = tasks.getById(id);
      if (!existing) return false;
      store.delRow('tasks', id);
      return true;
    },

    getByStatus(status: TaskStatus): Task[] {
      return tasks.getAll().filter((t) => t.status === status);
    },

    getPending(): Task[] {
      const timestamp = now();
      return tasks
        .getAll()
        .filter((t) => t.status === 'pending' && t.executeAt <= timestamp)
        .sort((a, b) => b.priority_value - a.priority_value || a.created_at - b.created_at);
    },

    getRetryable(): Task[] {
      const timestamp = now();
      return tasks.getAll().filter((t) => {
        if (t.status !== 'failed') return false;
        if (t.attempts >= t.maxAttempts) return false;
        if (t.next_retry_at && t.next_retry_at > timestamp) return false;
        return true;
      });
    },

    getBySession(sessionId: string): Task[] {
      return tasks.getAll().filter((t) => t.sessionId === sessionId);
    },

    subscribe(callback: SubscriptionCallback<Task>): Unsubscribe {
      taskListeners.add(callback);
      if (isInitialized) callback(tasks.getAll());
      return () => taskListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Extensions Store
  // --------------------------------------------------------------------------
  const extensionListeners = new Set<SubscriptionCallback<Extension>>();
  const notifyExtensionListeners = () => {
    const items = extensions.getAll();
    extensionListeners.forEach((l) => l(items));
  };

  const extensions: IExtensionStore = {
    getById(id: string): Extension | null {
      const row = store.getRow('extensions', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToExtension(id, row);
    },

    getAll(): Extension[] {
      const table = store.getTable('extensions');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToExtension(id, row));
    },
    count(): number {
      const table = store.getTable('extensions');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateExtension): Extension {
      const id = idGen.extension();
      const timestamp = now();
      const ext: Extension = {
        id,
        extension_type: data.extensionType,
        name: data.name,
        description: data.description,
        config_json: data.configJson,
        system_prompt: data.systemPrompt,
        user_prompt_template: data.userPromptTemplate,
        variables_schema_json: data.variablesSchemaJson,
        status: data.status ?? 'draft',
        version: data.version ?? 1,
        created_at: timestamp,
        verified_at: data.verifiedAt ?? null,
      };

      store.setRow('extensions', id, {
        extension_type: ext.extensionType,
        name: ext.name,
        description: ext.description,
        config_json: ext.configJson,
        system_prompt: ext.systemPrompt,
        user_prompt_template: ext.userPromptTemplate,
        variables_schema_json: ext.variablesSchemaJson,
        status: ext.status,
        version: ext.version,
        created_at: ext.created_at,
        verified_at: ext.verifiedAt ?? 0,
      });

      return ext;
    },

    update(id: string, data: UpdateExtension): Extension | null {
      const existing = extensions.getById(id);
      if (!existing) return null;

      const row = store.getRow('extensions', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('extensions', id, key, storeValue);
        }
      }

      return extensions.getById(id);
    },

    delete(id: string): boolean {
      const existing = extensions.getById(id);
      if (!existing) return false;
      store.delRow('extensions', id);
      return true;
    },

    getByType(type: ExtensionType): Extension[] {
      return extensions.getAll().filter((e) => e.extensionType === type);
    },

    getByStatus(status: ExtensionStatus): Extension[] {
      return extensions.getAll().filter((e) => e.status === status);
    },

    getProduction(): Extension[] {
      return extensions.getByStatus('production');
    },

    verify(id: string): Extension | null {
      return extensions.update(id, { status: 'verified', verified_at: now() });
    },

    subscribe(callback: SubscriptionCallback<Extension>): Unsubscribe {
      extensionListeners.add(callback);
      if (isInitialized) callback(extensions.getAll());
      return () => extensionListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Synthesis Cache Store
  // --------------------------------------------------------------------------
  const synthesisCacheListeners = new Set<SubscriptionCallback<SynthesisCache>>();
  const notifySynthesisCacheListeners = () => {
    const items = synthesisCache.getAll();
    synthesisCacheListeners.forEach((l) => l(items));
  };

  const synthesisCache: ISynthesisCacheStore = {
    getById(id: string): SynthesisCache | null {
      const row = store.getRow('synthesis_cache', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToSynthesisCache(id, row);
    },

    getAll(): SynthesisCache[] {
      const table = store.getTable('synthesis_cache');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToSynthesisCache(id, row));
    },
    count(): number {
      const table = store.getTable('synthesis_cache');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateSynthesisCache): SynthesisCache {
      const id = idGen.synthesisCache();
      const timestamp = now();
      const cache: SynthesisCache = {
        id,
        synthesis_type: data.synthesis_type,
        cache_key: data.cacheKey,
        content_json: data.contentJson,
        source_claims_json: data.source_claims_json,
        generated_at: timestamp,
        stale: data.stale ?? false,
        ttl_seconds: data.ttl_seconds,
      };

      store.setRow('synthesis_cache', id, {
        synthesis_type: cache.synthesis_type,
        cache_key: cache.cacheKey,
        content_json: cache.contentJson,
        source_claims_json: cache.source_claims_json,
        generated_at: cache.generatedAt,
        stale: cache.stale,
        ttl_seconds: cache.ttl_seconds,
      });

      return cache;
    },

    update(id: string, data: UpdateSynthesisCache): SynthesisCache | null {
      const existing = synthesisCache.getById(id);
      if (!existing) return null;

      const row = store.getRow('synthesis_cache', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('synthesis_cache', id, key, storeValue);
        }
      }

      return synthesisCache.getById(id);
    },

    delete(id: string): boolean {
      const existing = synthesisCache.getById(id);
      if (!existing) return false;
      store.delRow('synthesis_cache', id);
      return true;
    },

    getByType(type: string): SynthesisCache[] {
      return synthesisCache.getAll().filter((c) => c.synthesis_type === type);
    },

    getByCacheKey(key: string): SynthesisCache | null {
      return synthesisCache.getAll().find((c) => c.cacheKey === key) ?? null;
    },

    getValid(type: string): SynthesisCache[] {
      const timestamp = now();
      return synthesisCache.getAll().filter((c) =>
        c.synthesis_type === type &&
        !c.stale &&
        c.generatedAt + c.ttl_seconds * 1000 > timestamp
      );
    },

    markStale(id: string): void {
      synthesisCache.update(id, { stale: true });
    },

    cleanupExpired(): number {
      const timestamp = now();
      const expired = synthesisCache.getAll().filter(
        (c) => c.generatedAt + c.ttl_seconds * 1000 < timestamp
      );
      for (const cache of expired) {
        synthesisCache.delete(cache.id);
      }
      return expired.length;
    },

    subscribe(callback: SubscriptionCallback<SynthesisCache>): Unsubscribe {
      synthesisCacheListeners.add(callback);
      if (isInitialized) callback(synthesisCache.getAll());
      return () => synthesisCacheListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Extraction Programs Store
  // --------------------------------------------------------------------------
  const extractionProgramListeners = new Set<SubscriptionCallback<ExtractionProgram>>();
  const notifyExtractionProgramListeners = () => {
    const items = extractionPrograms.getAll();
    extractionProgramListeners.forEach((l) => l(items));
  };

  const extractionPrograms: IExtractionProgramStore = {
    getById(id: string): ExtractionProgram | null {
      const row = store.getRow('extraction_programs', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToExtractionProgram(id, row);
    },

    getAll(): ExtractionProgram[] {
      const table = store.getTable('extraction_programs');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToExtractionProgram(id, row));
    },
    count(): number {
      const table = store.getTable('extraction_programs');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateExtractionProgram): ExtractionProgram {
      const id = idGen.extractionProgram();
      const timestamp = now();
      const program: ExtractionProgram = {
        id,
        name: data.name,
        description: data.description,
        type: data.type,
        version: data.version ?? 1,
        patterns_json: data.patternsJson,
        always_run: data.alwaysRun,
        llm_tier: data.llmTier,
        llm_temperature: data.llmTemperature ?? null,
        llm_max_tokens: data.llmMaxTokens ?? null,
        prompt_template: data.promptTemplate,
        output_schema_json: data.outputSchemaJson,
        priority: data.priority,
        active: data.active ?? true,
        min_confidence: data.minConfidence,
        is_core: data.isCore ?? false,
        claim_types_json: data.claimTypesJson,
        success_rate: data.successRate ?? 0,
        run_count: data.runCount ?? 0,
        avg_processing_time_ms: data.avgProcessingTimeMs ?? 0,
        created_at: timestamp,
        updated_at: timestamp,
      };

      store.setRow('extraction_programs', id, {
        name: program.name,
        description: program.description,
        type: program.type,
        version: program.version,
        patterns_json: program.patternsJson,
        always_run: program.alwaysRun,
        llm_tier: program.llmTier,
        llm_temperature: program.llmTemperature || 0,
        llm_max_tokens: program.llmMaxTokens || 0,
        prompt_template: program.promptTemplate,
        output_schema_json: program.outputSchemaJson,
        priority: program.priority,
        active: program.active,
        min_confidence: program.minConfidence,
        is_core: program.isCore,
        claim_types_json: program.claimTypesJson,
        success_rate: program.successRate,
        run_count: program.runCount,
        avg_processing_time_ms: program.avgProcessingTimeMs,
        created_at: program.created_at,
        updated_at: program.updatedAt,
      });

      return program;
    },

    update(id: string, data: UpdateExtractionProgram): ExtractionProgram | null {
      const existing = extractionPrograms.getById(id);
      if (!existing) return null;

      const row = store.getRow('extraction_programs', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('extraction_programs', id, key, storeValue);
        }
      }

      // Update timestamp
      store.setCell('extraction_programs', id, 'updated_at', now());

      return extractionPrograms.getById(id);
    },

    delete(id: string): boolean {
      const existing = extractionPrograms.getById(id);
      if (!existing) return false;
      store.delRow('extraction_programs', id);
      return true;
    },

    getActive(): ExtractionProgram[] {
      return extractionPrograms.getAll().filter((p) => p.active);
    },

    getByType(type: string): ExtractionProgram[] {
      return extractionPrograms.getAll().filter((p) => p.type === type);
    },

    getCore(): ExtractionProgram[] {
      return extractionPrograms.getAll().filter((p) => p.isCore);
    },

    incrementRunCount(id: string): void {
      const program = extractionPrograms.getById(id);
      if (program) {
        extractionPrograms.update(id, { run_count: program.runCount + 1 });
      }
    },

    updateSuccessRate(id: string, success: boolean): void {
      const program = extractionPrograms.getById(id);
      if (program) {
        // Running average: new_rate = (old_rate * count + new_value) / (count + 1)
        const newRate = (program.successRate * program.runCount + (success ? 1 : 0)) / (program.runCount + 1);
        extractionPrograms.update(id, { success_rate: newRate });
      }
    },

    updateProcessingTime(id: string, timeMs: number): void {
      const program = extractionPrograms.getById(id);
      if (program) {
        // Running average
        const newAvg = (program.avgProcessingTimeMs * program.runCount + timeMs) / (program.runCount + 1);
        extractionPrograms.update(id, { avg_processing_time_ms: newAvg });
      }
    },

    subscribe(callback: SubscriptionCallback<ExtractionProgram>): Unsubscribe {
      extractionProgramListeners.add(callback);
      if (isInitialized) callback(extractionPrograms.getAll());
      return () => extractionProgramListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Observer Programs Store
  // --------------------------------------------------------------------------
  const observerProgramListeners = new Set<SubscriptionCallback<ObserverProgram>>();
  const notifyObserverProgramListeners = () => {
    const items = observerPrograms.getAll();
    observerProgramListeners.forEach((l) => l(items));
  };

  const observerPrograms: IObserverProgramStore = {
    getById(id: string): ObserverProgram | null {
      const row = store.getRow('observer_programs', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToObserverProgram(id, row);
    },

    getAll(): ObserverProgram[] {
      const table = store.getTable('observer_programs');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToObserverProgram(id, row));
    },
    count(): number {
      const table = store.getTable('observer_programs');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateObserverProgram): ObserverProgram {
      const id = idGen.observerProgram();
      const timestamp = now();
      const program: ObserverProgram = {
        id,
        name: data.name,
        type: data.type,
        description: data.description,
        active: data.active ?? true,
        priority: data.priority,
        triggers: data.triggers,
        claim_type_filter: data.claimTypeFilter ?? null,
        uses_llm: data.usesLlm,
        llm_tier: data.llmTier ?? null,
        llm_temperature: data.llmTemperature ?? null,
        llm_max_tokens: data.llmMaxTokens ?? null,
        prompt_template: data.promptTemplate ?? null,
        output_schema_json: data.outputSchemaJson ?? null,
        should_run_logic: data.shouldRunLogic ?? null,
        process_logic: data.process_logic ?? null,
        is_core: data.isCore ?? false,
        version: data.version ?? 1,
        created_at: timestamp,
        updated_at: timestamp,
        run_count: data.runCount ?? 0,
        success_rate: data.successRate ?? 0,
        avg_processing_time_ms: data.avgProcessingTimeMs ?? 0,
      };

      store.setRow('observer_programs', id, {
        name: program.name,
        type: program.type,
        description: program.description,
        active: program.active,
        priority: program.priority,
        triggers: JSON.stringify(program.triggers),
        claim_type_filter: program.claimTypeFilter || '',
        uses_llm: program.usesLlm,
        llm_tier: program.llmTier || '',
        llm_temperature: program.llmTemperature || 0,
        llm_max_tokens: program.llmMaxTokens || 0,
        prompt_template: program.promptTemplate || '',
        output_schema_json: program.outputSchemaJson || '',
        should_run_logic: program.shouldRunLogic || '',
        process_logic: program.process_logic || '',
        is_core: program.isCore,
        version: program.version,
        created_at: program.created_at,
        updated_at: program.updatedAt,
        run_count: program.runCount,
        success_rate: program.successRate,
        avg_processing_time_ms: program.avgProcessingTimeMs,
      });

      return program;
    },

    update(id: string, data: UpdateObserverProgram): ObserverProgram | null {
      const existing = observerPrograms.getById(id);
      if (!existing) return null;

      const row = store.getRow('observer_programs', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          if (key === 'triggers') {
            store.setCell('observer_programs', id, key, JSON.stringify(value));
          } else {
            const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
            store.setCell('observer_programs', id, key, storeValue as string | number | boolean);
          }
        }
      }

      // Update timestamp
      store.setCell('observer_programs', id, 'updated_at', now());

      return observerPrograms.getById(id);
    },

    delete(id: string): boolean {
      const existing = observerPrograms.getById(id);
      if (!existing) return false;
      store.delRow('observer_programs', id);
      return true;
    },

    getActive(): ObserverProgram[] {
      return observerPrograms.getAll().filter((p) => p.active);
    },

    getByType(type: ObserverType): ObserverProgram | null {
      return observerPrograms.getAll().find((p) => p.type === type) || null;
    },

    getCore(): ObserverProgram[] {
      return observerPrograms.getAll().filter((p) => p.isCore);
    },

    incrementRunCount(id: string): void {
      const program = observerPrograms.getById(id);
      if (program) {
        observerPrograms.update(id, { run_count: program.runCount + 1 });
      }
    },

    updateSuccessRate(id: string, success: boolean): void {
      const program = observerPrograms.getById(id);
      if (program) {
        // Running average
        const newRate = (program.successRate * program.runCount + (success ? 1 : 0)) / (program.runCount + 1);
        observerPrograms.update(id, { success_rate: newRate });
      }
    },

    updateProcessingTime(id: string, timeMs: number): void {
      const program = observerPrograms.getById(id);
      if (program) {
        // Running average
        const newAvg = (program.avgProcessingTimeMs * program.runCount + timeMs) / (program.runCount + 1);
        observerPrograms.update(id, { avg_processing_time_ms: newAvg });
      }
    },

    subscribe(callback: SubscriptionCallback<ObserverProgram>): Unsubscribe {
      observerProgramListeners.add(callback);
      if (isInitialized) callback(observerPrograms.getAll());
      return () => observerProgramListeners.delete(callback);
    },
  };

  // --------------------------------------------------------------------------
  // Corrections Store
  // --------------------------------------------------------------------------
  const correctionListeners = new Set<SubscriptionCallback<Correction>>();
  const notifyCorrectionListeners = () => {
    const items = corrections.getAll();
    correctionListeners.forEach((l) => l(items));
  };

  const corrections: ICorrectionStore = {
    getById(id: string): Correction | null {
      const row = store.getRow('corrections', id);
      if (!row || Object.keys(row).length === 0) return null;
      return rowToCorrection(id, row);
    },

    getAll(): Correction[] {
      const table = store.getTable('corrections');
      if (!table) return [];
      return Object.entries(table).map(([id, row]) => rowToCorrection(id, row));
    },
    count(): number {
      const table = store.getTable('corrections');
      if (!table) return 0;
      return Object.keys(table).length;
    },

    create(data: CreateCorrection): Correction {
      const id = idGen.correction();
      const timestamp = now();
      const correction: Correction = {
        id,
        wrongText: data.wrongText.toLowerCase(), // Normalize to lowercase
        correctText: data.correctText,
        originalCase: data.originalCase,
        usage_count: data.usageCount ?? 0,
        created_at: timestamp,
        last_used: timestamp,
        source_unit_id: data.sourceUnitId ?? null,
      };

      store.setRow('corrections', id, {
        wrongText: correction.wrongText,
        correctText: correction.correctText,
        originalCase: correction.originalCase,
        usage_count: correction.usageCount,
        created_at: correction.created_at,
        last_used: correction.lastUsed,
        source_unit_id: correction.sourceUnitId ?? '',
      });

      logger.debug('Created correction', { id, wrong: correction.wrongText, correct: correction.correctText });
      return correction;
    },

    update(id: string, data: UpdateCorrection): Correction | null {
      const existing = corrections.getById(id);
      if (!existing) return null;

      const row = store.getRow('corrections', id);
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          const storeValue = value === null ? (typeof row[key] === 'number' ? 0 : '') : value;
          store.setCell('corrections', id, key, storeValue);
        }
      }

      return corrections.getById(id);
    },

    delete(id: string): boolean {
      const existing = corrections.getById(id);
      if (!existing) return false;
      store.delRow('corrections', id);
      return true;
    },

    getByWrongText(wrongText: string): Correction | null {
      const normalized = wrongText.toLowerCase();
      return corrections.getAll().find((c) => c.wrongText === normalized) ?? null;
    },

    getFrequentlyUsed(limit: number): Correction[] {
      return corrections
        .getAll()
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, limit);
    },

    incrementUsageCount(id: string): void {
      const correction = corrections.getById(id);
      if (correction) {
        corrections.update(id, { usage_count: correction.usageCount + 1, last_used: now() });
      }
    },

    updateLastUsed(id: string): void {
      corrections.update(id, { last_used: now() });
    },

    subscribe(callback: SubscriptionCallback<Correction>): Unsubscribe {
      correctionListeners.add(callback);
      if (isInitialized) callback(corrections.getAll());
      return () => correctionListeners.delete(callback);
    },
  };

  // Helper for patterns (needed by observers)
  const patterns = {
    getAll: () => observerOutputs.getPatterns(),
  };

  // --------------------------------------------------------------------------
  // Main Store Instance
  // --------------------------------------------------------------------------
  const instance: ProgramStoreInstance = {
    sessions,
    conversations,
    claims,
    entities,
    goals,
    observerOutputs,
    tasks,
    extensions,
    synthesisCache,
    extractionPrograms,
    observerPrograms,
    corrections,
    patterns,
    sourceTracking,

    async initialize(): Promise<void> {
      if (isInitialized) return;
      if (initPromise) return initPromise;

      initPromise = (async () => {
        store = createStore();
        persister = createIndexedDbPersister(store, 'amigoz-program');

        await persister.load();
        await persister.startAutoSave();

        // Set up table listeners
        store.addTableListener('sessions', notifySessionListeners);
        store.addTableListener('conversations', () => {
          // Notify all session-specific listeners
          for (const [sessionId, listeners] of conversationListeners) {
            const items = conversations.getBySession(sessionId);
            listeners.forEach((l) => l(items));
          }
        });
        store.addTableListener('claims', () => {
          // Notify all session-specific listeners
          for (const [sessionId, listeners] of claimListeners) {
            const items = claims.getBySession(sessionId);
            listeners.forEach((l) => l(items));
          }
        });
        store.addTableListener('entities', notifyEntityListeners);
        store.addTableListener('goals', notifyGoalListeners);
        store.addTableListener('observer_outputs', notifyObserverOutputListeners);
        store.addTableListener('tasks', notifyTaskListeners);
        store.addTableListener('extensions', notifyExtensionListeners);
        store.addTableListener('synthesis_cache', notifySynthesisCacheListeners);
        store.addTableListener('extraction_programs', notifyExtractionProgramListeners);
        store.addTableListener('observer_programs', notifyObserverProgramListeners);
        store.addTableListener('corrections', notifyCorrectionListeners);

        isInitialized = true;
        logger.info('Program store initialized with IndexedDB');
      })();

      return initPromise;
    },

    isReady(): boolean {
      return isInitialized;
    },

    async ensureReady(): Promise<void> {
      await instance.initialize();
    },

    getStore(): Store {
      return store;
    },
  };

  return instance;
}

// Singleton instance
export const programStore = createProgramStore();
