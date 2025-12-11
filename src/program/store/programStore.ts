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
    started_at: row.started_at as number,
    ended_at: (row.ended_at as number) || null,
    unit_count: (row.unit_count as number) || 0,
    summary: (row.summary as string) || null,
    mood_trajectory_json: (row.mood_trajectory_json as string) || null,
  };
}

function rowToConversationUnit(id: string, row: Record<string, unknown>): ConversationUnit {
  return {
    id,
    session_id: row.session_id as string,
    timestamp: row.timestamp as number,
    raw_text: row.raw_text as string,
    sanitized_text: row.sanitized_text as string,
    source: row.source as 'speech' | 'text',
    preceding_context_summary: row.preceding_context_summary as string,
    created_at: row.created_at as number,
    processed: row.processed as boolean,
  };
}

function rowToClaim(id: string, row: Record<string, unknown>): Claim {
  return {
    id,
    statement: row.statement as string,
    subject: row.subject as string,
    claim_type: row.claim_type as ClaimType,
    temporality: row.temporality as Claim['temporality'],
    abstraction: row.abstraction as Claim['abstraction'],
    source_type: row.source_type as Claim['source_type'],
    initial_confidence: row.initial_confidence as number,
    current_confidence: row.current_confidence as number,
    state: row.state as ClaimState,
    emotional_valence: row.emotional_valence as number,
    emotional_intensity: row.emotional_intensity as number,
    stakes: row.stakes as Claim['stakes'],
    valid_from: row.valid_from as number,
    valid_until: (row.valid_until as number) || null,
    created_at: row.created_at as number,
    last_confirmed: row.last_confirmed as number,
    confirmation_count: row.confirmation_count as number,
    extraction_program_id: row.extraction_program_id as string,
    superseded_by: (row.superseded_by as string) || null,
    elaborates: (row.elaborates as string) || null,
    // Memory system fields
    memory_tier: (row.memory_tier as MemoryTier) || 'working',
    salience: (row.salience as number) || 0,
    promoted_at: (row.promoted_at as number) || null,
    last_accessed: (row.last_accessed as number) || row.created_at as number,
  };
}

function rowToClaimSource(id: string, row: Record<string, unknown>): ClaimSource {
  return {
    id,
    claim_id: row.claim_id as string,
    unit_id: row.unit_id as string,
  };
}

function rowToEntity(id: string, row: Record<string, unknown>): Entity {
  return {
    id,
    canonical_name: row.canonical_name as string,
    entity_type: row.entity_type as Entity['entity_type'],
    aliases: row.aliases as string,
    created_at: row.created_at as number,
    last_referenced: row.last_referenced as number,
    mention_count: row.mention_count as number,
  };
}

function rowToGoal(id: string, row: Record<string, unknown>): Goal {
  return {
    id,
    statement: row.statement as string,
    goal_type: row.goal_type as Goal['goal_type'],
    timeframe: row.timeframe as Goal['timeframe'],
    status: row.status as GoalStatus,
    parent_goal_id: (row.parent_goal_id as string) || null,
    created_at: row.created_at as number,
    last_referenced: row.last_referenced as number,
    priority: row.priority as number,
    progress_type: row.progress_type as Goal['progress_type'],
    progress_value: row.progress_value as number,
    progress_indicators_json: row.progress_indicators_json as string,
    blockers_json: row.blockers_json as string,
    source_claim_id: row.source_claim_id as string,
    motivation: (row.motivation as string) || null,
    deadline: (row.deadline as number) || null,
  };
}

function rowToObserverOutput(id: string, row: Record<string, unknown>): ObserverOutput {
  return {
    id,
    observer_type: row.observer_type as ObserverOutput['observer_type'],
    output_type: row.output_type as string,
    content_json: row.content_json as string,
    source_claims_json: row.source_claims_json as string,
    created_at: row.created_at as number,
    stale: row.stale as boolean,
  };
}

function rowToContradiction(id: string, row: Record<string, unknown>): Contradiction {
  return {
    id,
    claim_a_id: row.claim_a_id as string,
    claim_b_id: row.claim_b_id as string,
    detected_at: row.detected_at as number,
    contradiction_type: row.contradiction_type as Contradiction['contradiction_type'],
    resolved: row.resolved as boolean,
    resolution_type: (row.resolution_type as string) || null,
    resolution_notes: (row.resolution_notes as string) || null,
    resolved_at: (row.resolved_at as number) || null,
  };
}

function rowToPattern(id: string, row: Record<string, unknown>): Pattern {
  return {
    id,
    pattern_type: row.pattern_type as string,
    description: row.description as string,
    evidence_claims_json: row.evidence_claims_json as string,
    first_detected: row.first_detected as number,
    last_detected: row.last_detected as number,
    occurrence_count: row.occurrence_count as number,
    confidence: row.confidence as number,
  };
}

function rowToValue(id: string, row: Record<string, unknown>): Value {
  return {
    id,
    statement: row.statement as string,
    domain: row.domain as string,
    importance: row.importance as number,
    source_claim_id: row.source_claim_id as string,
    first_expressed: row.first_expressed as number,
    last_confirmed: row.last_confirmed as number,
    confirmation_count: row.confirmation_count as number,
  };
}

function rowToTask(id: string, row: Record<string, unknown>): Task {
  return {
    id,
    task_type: row.task_type as Task['task_type'],
    payload_json: row.payload_json as string,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    priority_value: row.priority_value as number,
    attempts: row.attempts as number,
    max_attempts: row.max_attempts as number,
    last_error: (row.last_error as string) || null,
    last_error_at: (row.last_error_at as number) || null,
    next_retry_at: (row.next_retry_at as number) || null,
    backoff_config_json: row.backoff_config_json as string,
    checkpoint_json: (row.checkpoint_json as string) || null,
    created_at: row.created_at as number,
    started_at: (row.started_at as number) || null,
    completed_at: (row.completed_at as number) || null,
    execute_at: row.execute_at as number,
    group_id: (row.group_id as string) || null,
    depends_on: (row.depends_on as string) || null,
    session_id: (row.session_id as string) || null,
  };
}

function rowToExtension(id: string, row: Record<string, unknown>): Extension {
  return {
    id,
    extension_type: row.extension_type as ExtensionType,
    name: row.name as string,
    description: row.description as string,
    config_json: row.config_json as string,
    system_prompt: row.system_prompt as string,
    user_prompt_template: row.user_prompt_template as string,
    variables_schema_json: row.variables_schema_json as string,
    status: row.status as ExtensionStatus,
    version: row.version as number,
    created_at: row.created_at as number,
    verified_at: (row.verified_at as number) || null,
  };
}

function rowToSynthesisCache(id: string, row: Record<string, unknown>): SynthesisCache {
  return {
    id,
    synthesis_type: row.synthesis_type as string,
    cache_key: row.cache_key as string,
    content_json: row.content_json as string,
    source_claims_json: row.source_claims_json as string,
    generated_at: row.generated_at as number,
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
    patterns_json: row.patterns_json as string,
    always_run: row.always_run as boolean,
    llm_provider: row.llm_provider as 'groq' | 'gemini',
    llm_model: (row.llm_model as string) || null,
    llm_temperature: (row.llm_temperature as number) === 0 ? null : (row.llm_temperature as number),
    llm_max_tokens: (row.llm_max_tokens as number) === 0 ? null : (row.llm_max_tokens as number),
    prompt_template: row.prompt_template as string,
    output_schema_json: row.output_schema_json as string,
    priority: row.priority as number,
    active: row.active as boolean,
    min_confidence: row.min_confidence as number,
    is_core: row.is_core as boolean,
    claim_types_json: row.claim_types_json as string,
    success_rate: row.success_rate as number,
    run_count: row.run_count as number,
    avg_processing_time_ms: row.avg_processing_time_ms as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
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
    claim_type_filter: (row.claim_type_filter as string) || null,
    uses_llm: row.uses_llm as boolean,
    llm_provider: (row.llm_provider as 'groq' | 'gemini') || null,
    llm_model: (row.llm_model as string) || null,
    llm_temperature: (row.llm_temperature as number) === 0 ? null : (row.llm_temperature as number),
    llm_max_tokens: (row.llm_max_tokens as number) === 0 ? null : (row.llm_max_tokens as number),
    prompt_template: (row.prompt_template as string) || null,
    output_schema_json: (row.output_schema_json as string) || null,
    should_run_logic: (row.should_run_logic as string) || null,
    process_logic: (row.process_logic as string) || null,
    is_core: row.is_core as boolean,
    version: row.version as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    run_count: row.run_count as number,
    success_rate: row.success_rate as number,
    avg_processing_time_ms: row.avg_processing_time_ms as number,
  };
}

function rowToCorrection(id: string, row: Record<string, unknown>): Correction {
  return {
    id,
    wrong_text: row.wrong_text as string,
    correct_text: row.correct_text as string,
    original_case: row.original_case as string,
    usage_count: row.usage_count as number,
    created_at: row.created_at as number,
    last_used: row.last_used as number,
    source_unit_id: (row.source_unit_id as string) || null,
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

    create(data: CreateSession): Session {
      const id = idGen.session();
      const timestamp = now();
      const session: Session = {
        id,
        started_at: data.started_at ?? timestamp,
        ended_at: data.ended_at ?? null,
        unit_count: data.unit_count ?? 0,
        summary: data.summary ?? null,
        mood_trajectory_json: data.mood_trajectory_json ?? null,
      };

      store.setRow('sessions', id, {
        started_at: session.started_at,
        ended_at: session.ended_at ?? 0,
        unit_count: session.unit_count,
        summary: session.summary ?? '',
        mood_trajectory_json: session.mood_trajectory_json ?? '',
      });

      logger.debug('Created session', { id });
      return session;
    },

    update(id: string, data: UpdateSession): Session | null {
      const existing = sessions.getById(id);
      if (!existing) return null;

      if (data.started_at !== undefined) store.setCell('sessions', id, 'started_at', data.started_at);
      if (data.ended_at !== undefined) store.setCell('sessions', id, 'ended_at', data.ended_at ?? 0);
      if (data.unit_count !== undefined) store.setCell('sessions', id, 'unit_count', data.unit_count);
      if (data.summary !== undefined) store.setCell('sessions', id, 'summary', data.summary ?? '');
      if (data.mood_trajectory_json !== undefined)
        store.setCell('sessions', id, 'mood_trajectory_json', data.mood_trajectory_json ?? '');

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
      return all.find((s) => s.ended_at === null) ?? null;
    },

    endSession(id: string): Session | null {
      return sessions.update(id, { ended_at: now() });
    },

    incrementUnitCount(id: string): void {
      const session = sessions.getById(id);
      if (session) {
        sessions.update(id, { unit_count: session.unit_count + 1 });
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

    create(data: CreateConversationUnit): ConversationUnit {
      const id = idGen.conversationUnit();
      const timestamp = now();
      const unit: ConversationUnit = {
        id,
        session_id: data.session_id,
        timestamp: data.timestamp,
        raw_text: data.raw_text,
        sanitized_text: data.sanitized_text,
        source: data.source,
        preceding_context_summary: data.preceding_context_summary,
        created_at: timestamp,
        processed: data.processed ?? false,
      };

      store.setRow('conversations', id, {
        session_id: unit.session_id,
        timestamp: unit.timestamp,
        raw_text: unit.raw_text,
        sanitized_text: unit.sanitized_text,
        source: unit.source,
        preceding_context_summary: unit.preceding_context_summary,
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
      return conversations.getAll().filter((c) => c.session_id === sessionId);
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

    create(data: CreateClaim): Claim {
      const id = idGen.claim();
      const timestamp = now();
      const claim: Claim = {
        id,
        statement: data.statement,
        subject: data.subject,
        claim_type: data.claim_type,
        temporality: data.temporality,
        abstraction: data.abstraction,
        source_type: data.source_type,
        initial_confidence: data.initial_confidence,
        current_confidence: data.initial_confidence,
        state: data.state ?? 'active',
        emotional_valence: data.emotional_valence,
        emotional_intensity: data.emotional_intensity,
        stakes: data.stakes,
        valid_from: data.valid_from,
        valid_until: data.valid_until,
        created_at: timestamp,
        last_confirmed: timestamp,
        confirmation_count: data.confirmation_count ?? 1,
        extraction_program_id: data.extraction_program_id,
        superseded_by: data.superseded_by ?? null,
        elaborates: data.elaborates,
        // Memory system fields
        memory_tier: data.memory_tier ?? 'working',
        salience: data.salience ?? 0,
        promoted_at: data.promoted_at ?? null,
        last_accessed: timestamp,
      };

      store.setRow('claims', id, {
        statement: claim.statement,
        subject: claim.subject,
        claim_type: claim.claim_type,
        temporality: claim.temporality,
        abstraction: claim.abstraction,
        source_type: claim.source_type,
        initial_confidence: claim.initial_confidence,
        current_confidence: claim.current_confidence,
        state: claim.state,
        emotional_valence: claim.emotional_valence,
        emotional_intensity: claim.emotional_intensity,
        stakes: claim.stakes,
        valid_from: claim.valid_from,
        valid_until: claim.valid_until ?? 0,
        created_at: claim.created_at,
        last_confirmed: claim.last_confirmed,
        confirmation_count: claim.confirmation_count,
        extraction_program_id: claim.extraction_program_id,
        superseded_by: claim.superseded_by ?? '',
        elaborates: claim.elaborates ?? '',
        // Memory system fields
        memory_tier: claim.memory_tier,
        salience: claim.salience,
        promoted_at: claim.promoted_at ?? 0,
        last_accessed: claim.last_accessed,
      });

      logger.debug('Created claim', { id, type: claim.claim_type });
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
      return claims.getAll().filter((c) => c.claim_type === type);
    },

    getBySubject(subject: string): Claim[] {
      return claims.getAll().filter((c) => c.subject === subject);
    },

    getBySession(sessionId: string): Claim[] {
      // Get all claim sources for units in this session
      const sessionUnits = conversations.getBySession(sessionId);
      const unitIds = new Set(sessionUnits.map((u) => u.id));
      const sources = claims.getSourcesForUnit('').filter((s) => unitIds.has(s.unit_id));
      const claimIds = new Set(sources.map((s) => s.claim_id));
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
          confirmation_count: claim.confirmation_count + 1,
        });
      }
    },

    supersedeClaim(id: string, newClaimId: string): void {
      claims.update(id, { state: 'superseded', superseded_by: newClaimId });
    },

    decayConfidence(id: string, factor: number): void {
      const claim = claims.getById(id);
      if (claim) {
        claims.update(id, { current_confidence: claim.current_confidence * factor });
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
        claim_id: source.claim_id,
        unit_id: source.unit_id,
      });

      return source;
    },

    getSourcesForClaim(claimId: string): ClaimSource[] {
      const table = store.getTable('claim_sources');
      if (!table) return [];
      return Object.entries(table)
        .filter(([, row]) => row.claim_id === claimId)
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
        .filter(([, row]) => row.unit_id === unitId)
        .map(([id, row]) => rowToClaimSource(id, row));
    },

    // Memory system methods
    getByMemoryTier(tier: MemoryTier): Claim[] {
      return claims.getAll().filter((c) => c.memory_tier === tier);
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
      if (claim && claim.memory_tier === 'working') {
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

    create(data: CreateEntity): Entity {
      const id = idGen.entity();
      const timestamp = now();
      // Normalize canonical name: trim whitespace and use proper casing
      const canonicalName = data.canonical_name.trim();

      const entity: Entity = {
        id,
        canonical_name: canonicalName,
        entity_type: data.entity_type,
        aliases: data.aliases,
        created_at: timestamp,
        last_referenced: timestamp,
        mention_count: data.mention_count ?? 1,
      };

      store.setRow('entities', id, {
        canonical_name: entity.canonical_name,
        entity_type: entity.entity_type,
        aliases: entity.aliases,
        created_at: entity.created_at,
        last_referenced: entity.last_referenced,
        mention_count: entity.mention_count,
      });

      logger.debug('Created entity', { id, name: entity.canonical_name });
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
      return entities.getAll().find((e) => e.canonical_name.trim().toLowerCase() === normalizedName) ?? null;
    },

    getByType(type: string): Entity[] {
      return entities.getAll().filter((e) => e.entity_type === type);
    },

    findByAlias(alias: string): Entity | null {
      const normalizedAlias = alias.trim().toLowerCase();
      return (
        entities.getAll().find((e) => {
          const aliases = parseAliases(e.aliases).map(a => a.trim().toLowerCase());
          const canonicalName = e.canonical_name.trim().toLowerCase();
          return aliases.includes(normalizedAlias) || canonicalName === normalizedAlias;
        }) ?? null
      );
    },

    incrementMentionCount(id: string): void {
      const entity = entities.getById(id);
      if (entity) {
        entities.update(id, { mention_count: entity.mention_count + 1 });
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
      const mergedAliases = [...new Set([...keepAliases, ...deleteAliases, deleteEntity.canonical_name])];

      // Update the entity we're keeping
      entities.update(keepId, {
        aliases: JSON.stringify(mergedAliases),
        mention_count: keepEntity.mention_count + deleteEntity.mention_count,
        last_referenced: Math.max(keepEntity.last_referenced, deleteEntity.last_referenced),
      });

      // Delete the duplicate entity
      entities.delete(deleteId);

      logger.info('Merged entities', {
        kept: { id: keepId, name: keepEntity.canonical_name },
        deleted: { id: deleteId, name: deleteEntity.canonical_name },
        newMentionCount: keepEntity.mention_count + deleteEntity.mention_count,
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

    create(data: CreateGoal): Goal {
      const id = idGen.goal();
      const timestamp = now();
      const goal: Goal = {
        id,
        statement: data.statement,
        goal_type: data.goal_type,
        timeframe: data.timeframe,
        status: data.status ?? 'active',
        parent_goal_id: data.parent_goal_id,
        created_at: timestamp,
        last_referenced: timestamp,
        priority: data.priority,
        progress_type: data.progress_type,
        progress_value: data.progress_value ?? 0,
        progress_indicators_json: data.progress_indicators_json ?? '[]',
        blockers_json: data.blockers_json ?? '[]',
        source_claim_id: data.source_claim_id,
        motivation: data.motivation,
        deadline: data.deadline,
      };

      store.setRow('goals', id, {
        statement: goal.statement,
        goal_type: goal.goal_type,
        timeframe: goal.timeframe,
        status: goal.status,
        parent_goal_id: goal.parent_goal_id ?? '',
        created_at: goal.created_at,
        last_referenced: goal.last_referenced,
        priority: goal.priority,
        progress_type: goal.progress_type,
        progress_value: goal.progress_value,
        progress_indicators_json: goal.progress_indicators_json,
        blockers_json: goal.blockers_json,
        source_claim_id: goal.source_claim_id,
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
        return goals.getAll().filter((g) => !g.parent_goal_id);
      }
      return goals.getAll().filter((g) => g.parent_goal_id === parentId);
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

    create(data: CreateObserverOutput): ObserverOutput {
      const id = idGen.observerOutput();
      const timestamp = now();
      const output: ObserverOutput = {
        id,
        observer_type: data.observer_type,
        output_type: data.output_type,
        content_json: data.content_json,
        source_claims_json: data.source_claims_json,
        created_at: timestamp,
        stale: data.stale ?? false,
      };

      store.setRow('observer_outputs', id, {
        observer_type: output.observer_type,
        output_type: output.output_type,
        content_json: output.content_json,
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
      if (data.content_json !== undefined) store.setCell('observer_outputs', id, 'content_json', data.content_json);
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
        claim_a_id: data.claim_a_id,
        claim_b_id: data.claim_b_id,
        detected_at: timestamp,
        contradiction_type: data.contradiction_type,
        resolved: data.resolved ?? false,
        resolution_type: data.resolution_type ?? null,
        resolution_notes: data.resolution_notes ?? null,
        resolved_at: data.resolved_at ?? null,
      };

      store.setRow('contradictions', id, {
        claim_a_id: contradiction.claim_a_id,
        claim_b_id: contradiction.claim_b_id,
        detected_at: contradiction.detected_at,
        contradiction_type: contradiction.contradiction_type,
        resolved: contradiction.resolved,
        resolution_type: contradiction.resolution_type ?? '',
        resolution_notes: contradiction.resolution_notes ?? '',
        resolved_at: contradiction.resolved_at ?? 0,
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
        evidence_claims_json: data.evidence_claims_json,
        first_detected: timestamp,
        last_detected: timestamp,
        occurrence_count: data.occurrence_count ?? 1,
        confidence: data.confidence,
      };

      store.setRow('patterns', id, {
        pattern_type: pattern.pattern_type,
        description: pattern.description,
        evidence_claims_json: pattern.evidence_claims_json,
        first_detected: pattern.first_detected,
        last_detected: pattern.last_detected,
        occurrence_count: pattern.occurrence_count,
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
        store.setCell('patterns', id, 'occurrence_count', pattern.occurrence_count + 1);
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
        source_claim_id: data.source_claim_id,
        first_expressed: timestamp,
        last_confirmed: timestamp,
        confirmation_count: data.confirmation_count ?? 1,
      };

      store.setRow('values', id, {
        statement: value.statement,
        domain: value.domain,
        importance: value.importance,
        source_claim_id: value.source_claim_id,
        first_expressed: value.first_expressed,
        last_confirmed: value.last_confirmed,
        confirmation_count: value.confirmation_count,
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
        store.setCell('values', id, 'confirmation_count', value.confirmation_count + 1);
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

    create(data: CreateTask): Task {
      const id = idGen.task();
      const timestamp = now();
      const priority = data.priority ?? 'normal';
      const task: Task = {
        id,
        task_type: data.task_type,
        payload_json: data.payload_json,
        status: 'pending',
        priority,
        priority_value: PRIORITY_VALUES[priority],
        attempts: 0,
        max_attempts: data.max_attempts ?? 5,
        last_error: null,
        last_error_at: null,
        next_retry_at: null,
        backoff_config_json: data.backoff_config_json ?? serializeBackoffConfig(DEFAULT_BACKOFF_CONFIG),
        checkpoint_json: null,
        created_at: timestamp,
        started_at: null,
        completed_at: null,
        execute_at: data.execute_at ?? timestamp,
        group_id: data.group_id ?? null,
        depends_on: data.depends_on ?? null,
        session_id: data.session_id ?? null,
      };

      store.setRow('tasks', id, {
        task_type: task.task_type,
        payload_json: task.payload_json,
        status: task.status,
        priority: task.priority,
        priority_value: task.priority_value,
        attempts: task.attempts,
        max_attempts: task.max_attempts,
        last_error: '',
        last_error_at: 0,
        next_retry_at: 0,
        backoff_config_json: task.backoff_config_json,
        checkpoint_json: '',
        created_at: task.created_at,
        started_at: 0,
        completed_at: 0,
        execute_at: task.execute_at,
        group_id: task.group_id ?? '',
        depends_on: task.depends_on ?? '',
        session_id: task.session_id ?? '',
      });

      logger.debug('Created task', { id, type: task.task_type });
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
        .filter((t) => t.status === 'pending' && t.execute_at <= timestamp)
        .sort((a, b) => b.priority_value - a.priority_value || a.created_at - b.created_at);
    },

    getRetryable(): Task[] {
      const timestamp = now();
      return tasks.getAll().filter((t) => {
        if (t.status !== 'failed') return false;
        if (t.attempts >= t.max_attempts) return false;
        if (t.next_retry_at && t.next_retry_at > timestamp) return false;
        return true;
      });
    },

    getBySession(sessionId: string): Task[] {
      return tasks.getAll().filter((t) => t.session_id === sessionId);
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

    create(data: CreateExtension): Extension {
      const id = idGen.extension();
      const timestamp = now();
      const ext: Extension = {
        id,
        extension_type: data.extension_type,
        name: data.name,
        description: data.description,
        config_json: data.config_json,
        system_prompt: data.system_prompt,
        user_prompt_template: data.user_prompt_template,
        variables_schema_json: data.variables_schema_json,
        status: data.status ?? 'draft',
        version: data.version ?? 1,
        created_at: timestamp,
        verified_at: data.verified_at ?? null,
      };

      store.setRow('extensions', id, {
        extension_type: ext.extension_type,
        name: ext.name,
        description: ext.description,
        config_json: ext.config_json,
        system_prompt: ext.system_prompt,
        user_prompt_template: ext.user_prompt_template,
        variables_schema_json: ext.variables_schema_json,
        status: ext.status,
        version: ext.version,
        created_at: ext.created_at,
        verified_at: ext.verified_at ?? 0,
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
      return extensions.getAll().filter((e) => e.extension_type === type);
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

    create(data: CreateSynthesisCache): SynthesisCache {
      const id = idGen.synthesisCache();
      const timestamp = now();
      const cache: SynthesisCache = {
        id,
        synthesis_type: data.synthesis_type,
        cache_key: data.cache_key,
        content_json: data.content_json,
        source_claims_json: data.source_claims_json,
        generated_at: timestamp,
        stale: data.stale ?? false,
        ttl_seconds: data.ttl_seconds,
      };

      store.setRow('synthesis_cache', id, {
        synthesis_type: cache.synthesis_type,
        cache_key: cache.cache_key,
        content_json: cache.content_json,
        source_claims_json: cache.source_claims_json,
        generated_at: cache.generated_at,
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
      return synthesisCache.getAll().find((c) => c.cache_key === key) ?? null;
    },

    getValid(type: string): SynthesisCache[] {
      const timestamp = now();
      return synthesisCache.getAll().filter((c) =>
        c.synthesis_type === type &&
        !c.stale &&
        c.generated_at + c.ttl_seconds * 1000 > timestamp
      );
    },

    markStale(id: string): void {
      synthesisCache.update(id, { stale: true });
    },

    cleanupExpired(): number {
      const timestamp = now();
      const expired = synthesisCache.getAll().filter(
        (c) => c.generated_at + c.ttl_seconds * 1000 < timestamp
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

    create(data: CreateExtractionProgram): ExtractionProgram {
      const id = idGen.extractionProgram();
      const timestamp = now();
      const program: ExtractionProgram = {
        id,
        name: data.name,
        description: data.description,
        type: data.type,
        version: data.version ?? 1,
        patterns_json: data.patterns_json,
        always_run: data.always_run,
        llm_provider: data.llm_provider,
        llm_model: data.llm_model ?? null,
        llm_temperature: data.llm_temperature ?? null,
        llm_max_tokens: data.llm_max_tokens ?? null,
        prompt_template: data.prompt_template,
        output_schema_json: data.output_schema_json,
        priority: data.priority,
        active: data.active ?? true,
        min_confidence: data.min_confidence,
        is_core: data.is_core ?? false,
        claim_types_json: data.claim_types_json,
        success_rate: data.success_rate ?? 0,
        run_count: data.run_count ?? 0,
        avg_processing_time_ms: data.avg_processing_time_ms ?? 0,
        created_at: timestamp,
        updated_at: timestamp,
      };

      store.setRow('extraction_programs', id, {
        name: program.name,
        description: program.description,
        type: program.type,
        version: program.version,
        patterns_json: program.patterns_json,
        always_run: program.always_run,
        llm_provider: program.llm_provider,
        llm_model: program.llm_model || '',
        llm_temperature: program.llm_temperature || 0,
        llm_max_tokens: program.llm_max_tokens || 0,
        prompt_template: program.prompt_template,
        output_schema_json: program.output_schema_json,
        priority: program.priority,
        active: program.active,
        min_confidence: program.min_confidence,
        is_core: program.is_core,
        claim_types_json: program.claim_types_json,
        success_rate: program.success_rate,
        run_count: program.run_count,
        avg_processing_time_ms: program.avg_processing_time_ms,
        created_at: program.created_at,
        updated_at: program.updated_at,
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
      return extractionPrograms.getAll().filter((p) => p.is_core);
    },

    incrementRunCount(id: string): void {
      const program = extractionPrograms.getById(id);
      if (program) {
        extractionPrograms.update(id, { run_count: program.run_count + 1 });
      }
    },

    updateSuccessRate(id: string, success: boolean): void {
      const program = extractionPrograms.getById(id);
      if (program) {
        // Running average: new_rate = (old_rate * count + new_value) / (count + 1)
        const newRate = (program.success_rate * program.run_count + (success ? 1 : 0)) / (program.run_count + 1);
        extractionPrograms.update(id, { success_rate: newRate });
      }
    },

    updateProcessingTime(id: string, timeMs: number): void {
      const program = extractionPrograms.getById(id);
      if (program) {
        // Running average
        const newAvg = (program.avg_processing_time_ms * program.run_count + timeMs) / (program.run_count + 1);
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
        claim_type_filter: data.claim_type_filter ?? null,
        uses_llm: data.uses_llm,
        llm_provider: data.llm_provider ?? null,
        llm_model: data.llm_model ?? null,
        llm_temperature: data.llm_temperature ?? null,
        llm_max_tokens: data.llm_max_tokens ?? null,
        prompt_template: data.prompt_template ?? null,
        output_schema_json: data.output_schema_json ?? null,
        should_run_logic: data.should_run_logic ?? null,
        process_logic: data.process_logic ?? null,
        is_core: data.is_core ?? false,
        version: data.version ?? 1,
        created_at: timestamp,
        updated_at: timestamp,
        run_count: data.run_count ?? 0,
        success_rate: data.success_rate ?? 0,
        avg_processing_time_ms: data.avg_processing_time_ms ?? 0,
      };

      store.setRow('observer_programs', id, {
        name: program.name,
        type: program.type,
        description: program.description,
        active: program.active,
        priority: program.priority,
        triggers: JSON.stringify(program.triggers),
        claim_type_filter: program.claim_type_filter || '',
        uses_llm: program.uses_llm,
        llm_provider: program.llm_provider || '',
        llm_model: program.llm_model || '',
        llm_temperature: program.llm_temperature || 0,
        llm_max_tokens: program.llm_max_tokens || 0,
        prompt_template: program.prompt_template || '',
        output_schema_json: program.output_schema_json || '',
        should_run_logic: program.should_run_logic || '',
        process_logic: program.process_logic || '',
        is_core: program.is_core,
        version: program.version,
        created_at: program.created_at,
        updated_at: program.updated_at,
        run_count: program.run_count,
        success_rate: program.success_rate,
        avg_processing_time_ms: program.avg_processing_time_ms,
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
      return observerPrograms.getAll().filter((p) => p.is_core);
    },

    incrementRunCount(id: string): void {
      const program = observerPrograms.getById(id);
      if (program) {
        observerPrograms.update(id, { run_count: program.run_count + 1 });
      }
    },

    updateSuccessRate(id: string, success: boolean): void {
      const program = observerPrograms.getById(id);
      if (program) {
        // Running average
        const newRate = (program.success_rate * program.run_count + (success ? 1 : 0)) / (program.run_count + 1);
        observerPrograms.update(id, { success_rate: newRate });
      }
    },

    updateProcessingTime(id: string, timeMs: number): void {
      const program = observerPrograms.getById(id);
      if (program) {
        // Running average
        const newAvg = (program.avg_processing_time_ms * program.run_count + timeMs) / (program.run_count + 1);
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

    create(data: CreateCorrection): Correction {
      const id = idGen.correction();
      const timestamp = now();
      const correction: Correction = {
        id,
        wrong_text: data.wrong_text.toLowerCase(), // Normalize to lowercase
        correct_text: data.correct_text,
        original_case: data.original_case,
        usage_count: data.usage_count ?? 0,
        created_at: timestamp,
        last_used: timestamp,
        source_unit_id: data.source_unit_id ?? null,
      };

      store.setRow('corrections', id, {
        wrong_text: correction.wrong_text,
        correct_text: correction.correct_text,
        original_case: correction.original_case,
        usage_count: correction.usage_count,
        created_at: correction.created_at,
        last_used: correction.last_used,
        source_unit_id: correction.source_unit_id ?? '',
      });

      logger.debug('Created correction', { id, wrong: correction.wrong_text, correct: correction.correct_text });
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
      return corrections.getAll().find((c) => c.wrong_text === normalized) ?? null;
    },

    getFrequentlyUsed(limit: number): Correction[] {
      return corrections
        .getAll()
        .sort((a, b) => b.usage_count - a.usage_count)
        .slice(0, limit);
    },

    incrementUsageCount(id: string): void {
      const correction = corrections.getById(id);
      if (correction) {
        corrections.update(id, { usage_count: correction.usage_count + 1, last_used: now() });
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
