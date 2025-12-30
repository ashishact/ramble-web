/**
 * Store Interfaces
 *
 * Abstract interfaces for all data stores.
 * Layered Architecture:
 * - Layer 0: Stream (conversations)
 * - Layer 1: Primitives (propositions, stances, relations, spans, entities)
 * - Layer 2: Derived (claims, goals, patterns, values, contradictions)
 */

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
  Task,
  CreateTask,
  UpdateTask,
} from '../types';

// ============================================================================
// Base Store Interface
// ============================================================================

/**
 * Generic store operations
 * All methods are now async for WatermelonDB compatibility
 */
export interface IBaseStore<T, TCreate, TUpdate> {
  getById(id: string): Promise<T | null>;
  getAll(): Promise<T[]>;
  count(): Promise<number>;
  create(data: TCreate): Promise<T>;
  update(id: string, data: TUpdate): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

/**
 * Subscription callback type
 */
export type SubscriptionCallback<T> = (items: T[]) => void;

/**
 * Unsubscribe function type
 */
export type Unsubscribe = () => void;

// ============================================================================
// LAYER 0: STREAM
// ============================================================================

export interface ISessionStore extends IBaseStore<Session, CreateSession, UpdateSession> {
  getActive(): Promise<Session | null>;
  endSession(id: string): Promise<Session | null>;
  incrementUnitCount(id: string): Promise<void>;
  subscribe(callback: SubscriptionCallback<Session>): Unsubscribe;
}

export interface IConversationStore
  extends IBaseStore<ConversationUnit, CreateConversationUnit, UpdateConversationUnit> {
  getBySession(sessionId: string): Promise<ConversationUnit[]>;
  getUnprocessed(): Promise<ConversationUnit[]>;
  markProcessed(id: string): Promise<void>;
  getRecent(limit: number): Promise<ConversationUnit[]>;
  subscribe(sessionId: string, callback: SubscriptionCallback<ConversationUnit>): Unsubscribe;
}

// ============================================================================
// LAYER 1: PRIMITIVES
// ============================================================================

import type {
  Proposition,
  CreateProposition,
  Stance,
  CreateStance,
  Relation,
  CreateRelation,
  Span,
  CreateSpan,
  PrimitiveEntity,
  CreatePrimitiveEntity,
  EntityMention,
  CreateEntityMention,
} from '../schemas/primitives'

export interface IPropositionStore extends IBaseStore<Proposition, CreateProposition, Partial<Proposition>> {
  getByConversation(conversationId: string): Promise<Proposition[]>
  getBySubject(subject: string): Promise<Proposition[]>
  getByType(type: string): Promise<Proposition[]>
  getRecent(limit: number): Promise<Proposition[]>
  subscribe(callback: SubscriptionCallback<Proposition>): Unsubscribe
}

export interface IStanceStore extends IBaseStore<Stance, CreateStance, Partial<Stance>> {
  getByProposition(propositionId: string): Promise<Stance[]>
  getByHolder(holder: string): Promise<Stance[]>
  getRecent(limit: number): Promise<Stance[]>
  subscribe(callback: SubscriptionCallback<Stance>): Unsubscribe
}

export interface IRelationStore extends IBaseStore<Relation, CreateRelation, Partial<Relation>> {
  getBySource(sourceId: string): Promise<Relation[]>
  getByTarget(targetId: string): Promise<Relation[]>
  getByCategory(category: string): Promise<Relation[]>
  subscribe(callback: SubscriptionCallback<Relation>): Unsubscribe
}

export interface ISpanStore extends IBaseStore<Span, CreateSpan, never> {
  getByConversation(conversationId: string): Promise<Span[]>
  getByPattern(patternId: string): Promise<Span[]>
  subscribe(callback: SubscriptionCallback<Span>): Unsubscribe
}

export interface IEntityMentionStore extends IBaseStore<EntityMention, CreateEntityMention, Partial<EntityMention>> {
  getByConversation(conversationId: string): Promise<EntityMention[]>
  getByResolvedEntity(entityId: string): Promise<EntityMention[]>
  getUnresolved(): Promise<EntityMention[]>
  getRecent(limit: number): Promise<EntityMention[]>
  resolve(id: string, entityId: string): Promise<EntityMention | null>
  subscribe(callback: SubscriptionCallback<EntityMention>): Unsubscribe
}

export interface IPrimitiveEntityStore extends IBaseStore<PrimitiveEntity, CreatePrimitiveEntity, Partial<PrimitiveEntity>> {
  getByName(name: string): Promise<PrimitiveEntity | null>
  getByType(type: string): Promise<PrimitiveEntity[]>
  getRecent(limit: number): Promise<PrimitiveEntity[]>
  subscribe(callback: SubscriptionCallback<PrimitiveEntity>): Unsubscribe
}

export interface IEntityStore extends IBaseStore<Entity, CreateEntity, UpdateEntity> {
  getByName(name: string): Promise<Entity | null>;
  getByType(type: string): Promise<Entity[]>;
  getRecent(limit: number): Promise<Entity[]>;
  findByAlias(alias: string): Promise<Entity | null>;
  incrementMentionCount(id: string): Promise<void>;
  updateLastReferenced(id: string): Promise<void>;
  mergeEntities(keepId: string, deleteId: string): Promise<Entity | null>;
  subscribe(callback: SubscriptionCallback<Entity>): Unsubscribe;
}

// ============================================================================
// LAYER 2: DERIVED
// ============================================================================

export interface IDerivedStore {
  getById(id: string): Promise<{ id: string; type: string; data: unknown } | null>
  getByType(type: string): Promise<Array<{ id: string; type: string; data: unknown }>>
  getStale(): Promise<Array<{ id: string; type: string }>>
  create(type: string, dependencyIds: string[], data: unknown): Promise<{ id: string }>
  markStale(id: string): Promise<void>
  markStaleByDependency(primitiveId: string): Promise<number>
  recompute(id: string, data: unknown): Promise<void>
}

export interface IClaimStore extends IBaseStore<Claim, CreateClaim, UpdateClaim> {
  getByState(state: ClaimState): Promise<Claim[]>;
  getByType(type: ClaimType): Promise<Claim[]>;
  getBySubject(subject: string): Promise<Claim[]>;
  getBySession(sessionId: string): Promise<Claim[]>;
  getRecent(limit: number): Promise<Claim[]>;
  confirmClaim(id: string): Promise<void>;
  supersedeClaim(id: string, newClaimId: string): Promise<void>;
  decayConfidence(id: string, factor: number): Promise<void>;
  subscribe(sessionId: string, callback: SubscriptionCallback<Claim>): Unsubscribe;

  // Claim sources (many-to-many with conversation units)
  addSource(data: CreateClaimSource): Promise<ClaimSource>;
  getSourcesForClaim(claimId: string): Promise<ClaimSource[]>;
  getSourcesForUnit(unitId: string): Promise<ClaimSource[]>;

  // Memory system methods
  getByMemoryTier(tier: MemoryTier): Promise<Claim[]>;
  getDecayable(): Promise<Claim[]>;
  updateSalience(id: string, salience: number): Promise<void>;
  updateLastAccessed(id: string): Promise<void>;
  promoteToLongTerm(id: string): Promise<void>;
  markStale(id: string): Promise<void>;
  markDormant(id: string): Promise<void>;
}

export interface IGoalStore extends IBaseStore<Goal, CreateGoal, UpdateGoal> {
  getByStatus(status: GoalStatus): Promise<Goal[]>;
  getActive(): Promise<Goal[]>;
  getByParent(parentId: string | null): Promise<Goal[]>;
  getRoots(): Promise<Goal[]>;
  getChildren(goalId: string): Promise<Goal[]>;
  updateProgress(id: string, value: number): Promise<void>;
  updateStatus(id: string, status: GoalStatus): Promise<void>;
  updateLastReferenced(id: string): Promise<void>;
  subscribe(callback: SubscriptionCallback<Goal>): Unsubscribe;
}

export interface IObserverOutputStore
  extends IBaseStore<ObserverOutput, CreateObserverOutput, UpdateObserverOutput> {
  getByType(type: string): Promise<ObserverOutput[]>;
  getRecent(limit: number): Promise<ObserverOutput[]>;
  markStale(id: string): Promise<void>;
  subscribe(callback: SubscriptionCallback<ObserverOutput>): Unsubscribe;

  // Contradictions
  addContradiction(data: CreateContradiction): Promise<Contradiction>;
  getContradictions(): Promise<Contradiction[]>;
  getUnresolvedContradictions(): Promise<Contradiction[]>;
  resolveContradiction(
    id: string,
    resolutionType: string,
    notes: string | null
  ): Promise<Contradiction | null>;

  // Patterns
  addPattern(data: CreatePattern): Promise<Pattern>;
  getPatterns(): Promise<Pattern[]>;
  reinforcePattern(id: string): Promise<void>;

  // Values
  addValue(data: CreateValue): Promise<Value>;
  getValues(): Promise<Value[]>;
  confirmValue(id: string): Promise<void>;
}

// ============================================================================
// OBSERVERS & EXTRACTORS
// ============================================================================

export interface IExtractionProgramStore
  extends IBaseStore<ExtractionProgram, CreateExtractionProgram, UpdateExtractionProgram> {
  getActive(): Promise<ExtractionProgram[]>;
  getByType(type: string): Promise<ExtractionProgram[]>;
  getCore(): Promise<ExtractionProgram[]>;
  incrementRunCount(id: string): Promise<void>;
  updateSuccessRate(id: string, success: boolean): Promise<void>;
  updateProcessingTime(id: string, timeMs: number): Promise<void>;
  subscribe(callback: SubscriptionCallback<ExtractionProgram>): Unsubscribe;
}

export interface IObserverProgramStore
  extends IBaseStore<ObserverProgram, CreateObserverProgram, UpdateObserverProgram> {
  getActive(): Promise<ObserverProgram[]>;
  getByType(type: ObserverType): Promise<ObserverProgram | null>;
  getCore(): Promise<ObserverProgram[]>;
  incrementRunCount(id: string): Promise<void>;
  updateSuccessRate(id: string, success: boolean): Promise<void>;
  updateProcessingTime(id: string, timeMs: number): Promise<void>;
  subscribe(callback: SubscriptionCallback<ObserverProgram>): Unsubscribe;
}

// ============================================================================
// SUPPORT
// ============================================================================

export interface IExtensionStore
  extends IBaseStore<Extension, CreateExtension, UpdateExtension> {
  getByType(type: ExtensionType): Promise<Extension[]>;
  getByStatus(status: ExtensionStatus): Promise<Extension[]>;
  getProduction(): Promise<Extension[]>;
  verify(id: string): Promise<Extension | null>;
  subscribe(callback: SubscriptionCallback<Extension>): Unsubscribe;
}

export interface ISynthesisCacheStore
  extends IBaseStore<SynthesisCache, CreateSynthesisCache, UpdateSynthesisCache> {
  getByType(type: string): Promise<SynthesisCache[]>;
  getByCacheKey(key: string): Promise<SynthesisCache | null>;
  getValid(type: string): Promise<SynthesisCache[]>;
  markStale(id: string): Promise<void>;
  cleanupExpired(): Promise<number>;
  subscribe(callback: SubscriptionCallback<SynthesisCache>): Unsubscribe;
}

export interface ICorrectionStore
  extends IBaseStore<Correction, CreateCorrection, UpdateCorrection> {
  getByWrongText(wrongText: string): Promise<Correction | null>;
  getFrequentlyUsed(limit: number): Promise<Correction[]>;
  incrementUsageCount(id: string): Promise<void>;
  updateLastUsed(id: string): Promise<void>;
  subscribe(callback: SubscriptionCallback<Correction>): Unsubscribe;
}

import type {
  Vocabulary,
  CreateVocabulary,
  UpdateVocabulary,
  VocabularyEntityType,
} from '../schemas/vocabulary';

export interface IVocabularyStore
  extends IBaseStore<Vocabulary, CreateVocabulary, UpdateVocabulary> {
  getByCorrectSpelling(spelling: string): Promise<Vocabulary | null>;
  getByPhoneticCode(code: string): Promise<Vocabulary[]>;
  getByEntityType(type: VocabularyEntityType): Promise<Vocabulary[]>;
  getBySourceEntity(entityId: string): Promise<Vocabulary | null>;
  incrementUsageCount(id: string): Promise<void>;
  incrementVariantCount(id: string, variant: string): Promise<void>;
  getFrequentlyUsed(limit: number): Promise<Vocabulary[]>;
  subscribe(callback: SubscriptionCallback<Vocabulary>): Unsubscribe;
}

export interface ITaskStore extends IBaseStore<Task, CreateTask, UpdateTask> {
  getPending(): Promise<Task[]>;
  getRetryable(): Promise<Task[]>;
  getByStatus(status: string): Promise<Task[]>;
  getBySessionId(sessionId: string): Promise<Task[]>;
  markStarted(id: string): Promise<void>;
  markCompleted(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  updateCheckpoint(id: string, checkpoint: string): Promise<void>;
  subscribe(callback: SubscriptionCallback<Task>): Unsubscribe;
}

// ============================================================================
// DEBUG / TRACING
// ============================================================================

export interface ExtractionTraceRecord {
  id: string;
  targetType: string;
  targetId: string;
  conversationId: string;
  inputText: string;
  spanId: string | null;
  charStart: number | null;
  charEnd: number | null;
  matchedPattern: string | null;
  matchedText: string | null;
  llmPrompt: string | null;
  llmResponse: string | null;
  llmModel: string | null;
  llmTokensUsed: number | null;
  processingTimeMs: number;
  extractorId: string | null;
  error: string | null;
  createdAt: number;
}

export interface CreateExtractionTrace {
  targetType: string;
  targetId: string;
  conversationId: string;
  inputText: string;
  spanId?: string | null;
  charStart?: number | null;
  charEnd?: number | null;
  matchedPattern?: string | null;
  matchedText?: string | null;
  llmPrompt?: string | null;
  llmResponse?: string | null;
  llmModel?: string | null;
  llmTokensUsed?: number | null;
  processingTimeMs: number;
  extractorId?: string | null;
  error?: string | null;
}

export interface IExtractionTraceStore {
  getById(id: string): Promise<ExtractionTraceRecord | null>;
  getByTargetId(targetId: string): Promise<ExtractionTraceRecord[]>;
  getByConversation(conversationId: string): Promise<ExtractionTraceRecord[]>;
  getByType(targetType: string): Promise<ExtractionTraceRecord[]>;
  getRecent(limit: number): Promise<ExtractionTraceRecord[]>;
  create(data: CreateExtractionTrace): Promise<ExtractionTraceRecord>;
  delete(id: string): Promise<boolean>;
  deleteByConversation(conversationId: string): Promise<number>;
}

// ============================================================================
// Combined Store Interface
// ============================================================================

/**
 * Main store interface combining all stores
 */
export interface IProgramStore {
  // Layer 0: Stream
  sessions: ISessionStore;
  conversations: IConversationStore;

  // Layer 1: Primitives
  propositions: IPropositionStore;
  stances: IStanceStore;
  relations: IRelationStore;
  spans: ISpanStore;
  entityMentions: IEntityMentionStore;
  primitiveEntities: IPrimitiveEntityStore;  // Legacy, keeping for backward compat
  entities: IEntityStore;  // Layer 2: Canonical entities

  // Layer 2: Derived
  derived: IDerivedStore;
  claims: IClaimStore;
  goals: IGoalStore;
  observerOutputs: IObserverOutputStore;

  // Observers & Extractors
  extractionPrograms: IExtractionProgramStore;
  observerPrograms: IObserverProgramStore;

  // Support
  extensions: IExtensionStore;
  synthesisCache: ISynthesisCacheStore;
  corrections: ICorrectionStore;
  vocabulary: IVocabularyStore;
  tasks: ITaskStore;

  // Debug / Tracing
  extractionTraces: IExtractionTraceStore;

  /**
   * Initialize the store (load from IndexedDB)
   */
  initialize(): Promise<void>;

  /**
   * Check if store is ready
   */
  isReady(): boolean;

  /**
   * Wait for store to be ready
   */
  ensureReady(): Promise<void>;
}
