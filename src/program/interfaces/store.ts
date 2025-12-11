/**
 * Store Interfaces
 *
 * Abstract interfaces for all data stores.
 * These define the contract that TinyBase implementations must fulfill.
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
  SourceTracking,
  CreateSourceTracking,
  UpdateObserverProgram,
  ObserverType,
  Correction,
  CreateCorrection,
  UpdateCorrection,
  MemoryTier,
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
  count(): Promise<number>; // Get total count without loading all items
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
// Session Store
// ============================================================================

export interface ISessionStore extends IBaseStore<Session, CreateSession, UpdateSession> {
  getActive(): Promise<Session | null>;
  endSession(id: string): Promise<Session | null>;
  incrementUnitCount(id: string): Promise<void>;
  subscribe(callback: SubscriptionCallback<Session>): Unsubscribe;
}

// ============================================================================
// Conversation Store
// ============================================================================

export interface IConversationStore
  extends IBaseStore<ConversationUnit, CreateConversationUnit, UpdateConversationUnit> {
  getBySession(sessionId: string): Promise<ConversationUnit[]>;
  getUnprocessed(): Promise<ConversationUnit[]>;
  markProcessed(id: string): Promise<void>;
  getRecent(limit: number): Promise<ConversationUnit[]>;
  subscribe(sessionId: string, callback: SubscriptionCallback<ConversationUnit>): Unsubscribe;
}

// ============================================================================
// Claim Store
// ============================================================================

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
  getDecayable(): Promise<Claim[]>; // All non-eternal claims
  updateSalience(id: string, salience: number): Promise<void>;
  updateLastAccessed(id: string): Promise<void>;
  promoteToLongTerm(id: string): Promise<void>;
  markStale(id: string): Promise<void>;
  markDormant(id: string): Promise<void>;
}

// ============================================================================
// Source Tracking Store
// ============================================================================

export interface ISourceTrackingStore
  extends IBaseStore<SourceTracking, CreateSourceTracking, never> {
  getByClaimId(claimId: string): Promise<SourceTracking | null>;
  getByUnitId(unitId: string): Promise<SourceTracking[]>;
  deleteByClaimId(claimId: string): Promise<boolean>;
}

// ============================================================================
// Entity Store
// ============================================================================

export interface IEntityStore extends IBaseStore<Entity, CreateEntity, UpdateEntity> {
  getByName(name: string): Promise<Entity | null>;
  getByType(type: string): Promise<Entity[]>;
  findByAlias(alias: string): Promise<Entity | null>;
  incrementMentionCount(id: string): Promise<void>;
  updateLastReferenced(id: string): Promise<void>;
  mergeEntities(keepId: string, deleteId: string): Promise<Entity | null>;
  subscribe(callback: SubscriptionCallback<Entity>): Unsubscribe;
}

// ============================================================================
// Goal Store
// ============================================================================

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

// ============================================================================
// Observer Output Store
// ============================================================================

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
// Extension Store
// ============================================================================

export interface IExtensionStore
  extends IBaseStore<Extension, CreateExtension, UpdateExtension> {
  getByType(type: ExtensionType): Promise<Extension[]>;
  getByStatus(status: ExtensionStatus): Promise<Extension[]>;
  getProduction(): Promise<Extension[]>;
  verify(id: string): Promise<Extension | null>;
  subscribe(callback: SubscriptionCallback<Extension>): Unsubscribe;
}

// ============================================================================
// Synthesis Cache Store
// ============================================================================

export interface ISynthesisCacheStore
  extends IBaseStore<SynthesisCache, CreateSynthesisCache, UpdateSynthesisCache> {
  getByType(type: string): Promise<SynthesisCache[]>;
  getByCacheKey(key: string): Promise<SynthesisCache | null>;
  getValid(type: string): Promise<SynthesisCache[]>;
  markStale(id: string): Promise<void>;
  cleanupExpired(): Promise<number>;
  subscribe(callback: SubscriptionCallback<SynthesisCache>): Unsubscribe;
}

// ============================================================================
// Extraction Program Store
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

// ============================================================================
// Observer Program Store
// ============================================================================

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
// Correction Store
// ============================================================================

export interface ICorrectionStore
  extends IBaseStore<Correction, CreateCorrection, UpdateCorrection> {
  getByWrongText(wrongText: string): Promise<Correction | null>;
  getFrequentlyUsed(limit: number): Promise<Correction[]>;
  incrementUsageCount(id: string): Promise<void>;
  updateLastUsed(id: string): Promise<void>;
  subscribe(callback: SubscriptionCallback<Correction>): Unsubscribe;
}

// ============================================================================
// Combined Store Interface
// ============================================================================

/**
 * Main store interface combining all stores
 */
export interface IProgramStore {
  sessions: ISessionStore;
  conversations: IConversationStore;
  claims: IClaimStore;
  sourceTracking: ISourceTrackingStore;
  entities: IEntityStore;
  goals: IGoalStore;
  observerOutputs: IObserverOutputStore;
  extensions: IExtensionStore;
  synthesisCache: ISynthesisCacheStore;
  extractionPrograms: IExtractionProgramStore;
  observerPrograms: IObserverProgramStore;
  corrections: ICorrectionStore;

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
