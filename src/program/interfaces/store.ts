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
  ThoughtChain,
  CreateThoughtChain,
  UpdateThoughtChain,
  ChainClaim,
  CreateChainClaim,
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
  ChainState,
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
} from '../types';

// ============================================================================
// Base Store Interface
// ============================================================================

/**
 * Generic store operations
 */
export interface IBaseStore<T, TCreate, TUpdate> {
  getById(id: string): T | null;
  getAll(): T[];
  create(data: TCreate): T;
  update(id: string, data: TUpdate): T | null;
  delete(id: string): boolean;
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
  getActive(): Session | null;
  endSession(id: string): Session | null;
  incrementUnitCount(id: string): void;
  subscribe(callback: SubscriptionCallback<Session>): Unsubscribe;
}

// ============================================================================
// Conversation Store
// ============================================================================

export interface IConversationStore
  extends IBaseStore<ConversationUnit, CreateConversationUnit, UpdateConversationUnit> {
  getBySession(sessionId: string): ConversationUnit[];
  getUnprocessed(): ConversationUnit[];
  markProcessed(id: string): void;
  getRecent(limit: number): ConversationUnit[];
  subscribe(sessionId: string, callback: SubscriptionCallback<ConversationUnit>): Unsubscribe;
}

// ============================================================================
// Claim Store
// ============================================================================

export interface IClaimStore extends IBaseStore<Claim, CreateClaim, UpdateClaim> {
  getByState(state: ClaimState): Claim[];
  getByType(type: ClaimType): Claim[];
  getByChain(chainId: string): Claim[];
  getBySubject(subject: string): Claim[];
  getBySession(sessionId: string): Claim[];
  getRecent(limit: number): Claim[];
  confirmClaim(id: string): void;
  supersedeClaim(id: string, newClaimId: string): void;
  decayConfidence(id: string, factor: number): void;
  subscribe(sessionId: string, callback: SubscriptionCallback<Claim>): Unsubscribe;

  // Claim sources (many-to-many with conversation units)
  addSource(data: CreateClaimSource): ClaimSource;
  getSourcesForClaim(claimId: string): ClaimSource[];
  getSourcesForUnit(unitId: string): ClaimSource[];
}

// ============================================================================
// Entity Store
// ============================================================================

export interface IEntityStore extends IBaseStore<Entity, CreateEntity, UpdateEntity> {
  getByName(name: string): Entity | null;
  getByType(type: string): Entity[];
  findByAlias(alias: string): Entity | null;
  incrementMentionCount(id: string): void;
  updateLastReferenced(id: string): void;
  subscribe(callback: SubscriptionCallback<Entity>): Unsubscribe;
}

// ============================================================================
// Thought Chain Store
// ============================================================================

export interface IChainStore
  extends IBaseStore<ThoughtChain, CreateThoughtChain, UpdateThoughtChain> {
  getByState(state: ChainState): ThoughtChain[];
  getActive(): ThoughtChain[];
  getDormant(): ThoughtChain[];
  extendChain(id: string): void;
  markDormant(id: string): void;
  markConcluded(id: string): void;
  revive(id: string): void;
  subscribe(callback: SubscriptionCallback<ThoughtChain>): Unsubscribe;

  // Chain-claim relationships
  addClaimToChain(data: CreateChainClaim): ChainClaim;
  getClaimsInChain(chainId: string): ChainClaim[];
  getChainForClaim(claimId: string): string | null;
}

// ============================================================================
// Goal Store
// ============================================================================

export interface IGoalStore extends IBaseStore<Goal, CreateGoal, UpdateGoal> {
  getByStatus(status: GoalStatus): Goal[];
  getActive(): Goal[];
  getByParent(parentId: string | null): Goal[];
  getRoots(): Goal[];
  getChildren(goalId: string): Goal[];
  updateProgress(id: string, value: number): void;
  updateStatus(id: string, status: GoalStatus): void;
  updateLastReferenced(id: string): void;
  subscribe(callback: SubscriptionCallback<Goal>): Unsubscribe;
}

// ============================================================================
// Observer Output Store
// ============================================================================

export interface IObserverOutputStore
  extends IBaseStore<ObserverOutput, CreateObserverOutput, UpdateObserverOutput> {
  getByType(type: string): ObserverOutput[];
  getRecent(limit: number): ObserverOutput[];
  markStale(id: string): void;
  subscribe(callback: SubscriptionCallback<ObserverOutput>): Unsubscribe;

  // Contradictions
  addContradiction(data: CreateContradiction): Contradiction;
  getContradictions(): Contradiction[];
  getUnresolvedContradictions(): Contradiction[];
  resolveContradiction(
    id: string,
    resolutionType: string,
    notes: string | null
  ): Contradiction | null;

  // Patterns
  addPattern(data: CreatePattern): Pattern;
  getPatterns(): Pattern[];
  reinforcePattern(id: string): void;

  // Values
  addValue(data: CreateValue): Value;
  getValues(): Value[];
  confirmValue(id: string): void;
}

// ============================================================================
// Extension Store
// ============================================================================

export interface IExtensionStore
  extends IBaseStore<Extension, CreateExtension, UpdateExtension> {
  getByType(type: ExtensionType): Extension[];
  getByStatus(status: ExtensionStatus): Extension[];
  getProduction(): Extension[];
  verify(id: string): Extension | null;
  subscribe(callback: SubscriptionCallback<Extension>): Unsubscribe;
}

// ============================================================================
// Synthesis Cache Store
// ============================================================================

export interface ISynthesisCacheStore
  extends IBaseStore<SynthesisCache, CreateSynthesisCache, UpdateSynthesisCache> {
  getByType(type: string): SynthesisCache[];
  getByCacheKey(key: string): SynthesisCache | null;
  getValid(type: string): SynthesisCache[];
  markStale(id: string): void;
  cleanupExpired(): number;
  subscribe(callback: SubscriptionCallback<SynthesisCache>): Unsubscribe;
}

// ============================================================================
// Extraction Program Store
// ============================================================================

export interface IExtractionProgramStore
  extends IBaseStore<ExtractionProgram, CreateExtractionProgram, UpdateExtractionProgram> {
  getActive(): ExtractionProgram[];
  getByType(type: string): ExtractionProgram[];
  getCore(): ExtractionProgram[];
  incrementRunCount(id: string): void;
  updateSuccessRate(id: string, success: boolean): void;
  subscribe(callback: SubscriptionCallback<ExtractionProgram>): Unsubscribe;
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
  entities: IEntityStore;
  chains: IChainStore;
  goals: IGoalStore;
  observerOutputs: IObserverOutputStore;
  extensions: IExtensionStore;
  synthesisCache: ISynthesisCacheStore;
  extractionPrograms: IExtractionProgramStore;

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
