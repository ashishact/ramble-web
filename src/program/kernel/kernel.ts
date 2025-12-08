/**
 * Program Kernel
 *
 * The central orchestrator that ties together all program components:
 * - Store (TinyBase + IndexedDB)
 * - Queue Runner (durable task execution)
 * - Extraction Pipeline
 * - Chain Manager
 * - Goal Manager
 * - Observer Dispatcher
 *
 * Provides a unified API for the UI and external consumers.
 */

import { createProgramStore, type ProgramStoreInstance } from '../store/programStore';
import { QueueRunner, createQueueRunner } from '../pipeline/queueRunner';
import { runExtractionPipeline, type PipelineInput, type PipelineOutput } from '../pipeline/extractionPipeline';
import { ChainManager, createChainManager } from '../chains/chainManager';
import { GoalManager, createGoalManager } from '../goals/goalManager';
import { ObserverDispatcher, createStandardDispatcher } from '../observers';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

// Import extractors to trigger registration (side-effect import)
import '../extractors/programs';
import type {
  Session,
  ConversationUnit,
  CreateConversationUnit,
  Claim,
  Entity,
  ThoughtChain,
  Goal,
  ConversationSource,
} from '../types';

const logger = createLogger('Kernel');

// ============================================================================
// Kernel Configuration
// ============================================================================

export interface KernelConfig {
  /** Enable automatic observer execution */
  autoObservers: boolean;
  /** Maximum concurrent queue tasks */
  maxConcurrentTasks: number;
  /** Queue poll interval in ms */
  queuePollInterval: number;
  /** Enable debug logging */
  debug: boolean;
}

const DEFAULT_CONFIG: KernelConfig = {
  autoObservers: true,
  maxConcurrentTasks: 3,
  queuePollInterval: 1000,
  debug: false,
};

// ============================================================================
// Kernel State
// ============================================================================

export interface KernelState {
  initialized: boolean;
  activeSession: Session | null;
  queueRunning: boolean;
  stats: KernelStats;
}

export interface KernelStats {
  totalUnitsProcessed: number;
  totalClaimsExtracted: number;
  totalObserverRuns: number;
  uptime: number;
}

// ============================================================================
// Task Payloads
// ============================================================================

interface ExtractFromUnitPayload {
  unitId: string;
  sessionId: string;
}

// ============================================================================
// Kernel Implementation
// ============================================================================

export class ProgramKernel {
  private config: KernelConfig;
  private store: ProgramStoreInstance | null = null;
  private queueRunner: QueueRunner | null = null;
  private chainManager: ChainManager | null = null;
  private goalManager: GoalManager | null = null;
  private dispatcher: ObserverDispatcher | null = null;

  private state: KernelState = {
    initialized: false,
    activeSession: null,
    queueRunning: false,
    stats: {
      totalUnitsProcessed: 0,
      totalClaimsExtracted: 0,
      totalObserverRuns: 0,
      uptime: 0,
    },
  };

  private startTime: number = 0;

  constructor(config?: Partial<KernelConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize the kernel
   */
  async initialize(): Promise<void> {
    if (this.state.initialized) {
      logger.warn('Kernel already initialized');
      return;
    }

    logger.info('Initializing Program Kernel...');
    this.startTime = now();

    try {
      // Initialize store
      this.store = createProgramStore();
      await this.store.initialize();

      // Initialize managers
      this.chainManager = createChainManager(this.store);
      this.goalManager = createGoalManager(this.store);
      this.dispatcher = createStandardDispatcher(this.store, {
        autoRun: this.config.autoObservers,
      });

      // Initialize queue runner
      this.queueRunner = createQueueRunner(this.store, {
        maxConcurrent: this.config.maxConcurrentTasks,
        pollInterval: this.config.queuePollInterval,
      });

      // Register task handlers
      this.registerTaskHandlers();

      // Check for active session
      this.state.activeSession = this.store.sessions.getActive();

      // If there's an active session, start the queue to resume processing
      if (this.state.activeSession) {
        console.log('[Kernel] Found active session, starting queue runner...');
        this.queueRunner.start();
        this.state.queueRunning = true;
      }

      this.state.initialized = true;
      logger.info('Program Kernel initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize kernel', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Shutdown the kernel
   */
  async shutdown(): Promise<void> {
    if (!this.state.initialized) return;

    logger.info('Shutting down Program Kernel...');

    // Stop queue runner
    this.queueRunner?.stop();

    // End active session if any
    if (this.state.activeSession) {
      this.store?.sessions.endSession(this.state.activeSession.id);
    }

    this.state.initialized = false;
    logger.info('Program Kernel shut down');
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Start a new session
   */
  startSession(_metadata?: Record<string, unknown>): Session {
    this.ensureInitialized();

    // End existing session if any
    if (this.state.activeSession) {
      this.store!.sessions.endSession(this.state.activeSession.id);
    }

    const session = this.store!.sessions.create({
      started_at: now(),
      ended_at: null,
      unit_count: 0,
      summary: null,
      mood_trajectory_json: null,
    });

    this.state.activeSession = session;

    // Start queue processing
    this.queueRunner!.start();
    this.state.queueRunning = true;

    logger.info('Started new session', { sessionId: session.id });

    return session;
  }

  /**
   * End the current session
   */
  endSession(): void {
    this.ensureInitialized();

    if (!this.state.activeSession) {
      logger.warn('No active session to end');
      return;
    }

    const sessionId = this.state.activeSession.id;

    // Trigger session_end observers
    this.dispatcher?.onSessionEnd(sessionId);

    // End session in store
    this.store!.sessions.endSession(sessionId);
    this.state.activeSession = null;

    // Stop queue runner
    this.queueRunner!.stop();
    this.state.queueRunning = false;

    logger.info('Ended session', { sessionId });
  }

  /**
   * Get the active session
   */
  getActiveSession(): Session | null {
    return this.state.activeSession;
  }

  // ==========================================================================
  // Conversation Processing
  // ==========================================================================

  /**
   * Process a new conversation unit (text from voice or input)
   */
  async processText(
    rawText: string,
    source: ConversationSource,
    _metadata?: Record<string, unknown>
  ): Promise<{ unit: ConversationUnit; taskId: string }> {
    logger.info('processText called', { textLength: rawText.length, source });

    this.ensureInitialized();
    this.ensureActiveSession();

    // Sanitize text
    const sanitizedText = this.sanitizeText(rawText);

    // Create conversation unit
    const data: CreateConversationUnit = {
      session_id: this.state.activeSession!.id,
      timestamp: now(),
      raw_text: rawText,
      sanitized_text: sanitizedText,
      source,
      preceding_context_summary: this.buildPrecedingContext(this.state.activeSession!.id, ''),
      processed: false,
    };

    const unit = this.store!.conversations.create(data);

    // Update session unit count
    this.store!.sessions.incrementUnitCount(this.state.activeSession!.id);

    // Queue extraction task
    const taskId = await this.queueRunner!.enqueue({
      task_type: 'extract_from_unit',
      payload_json: JSON.stringify({
        unitId: unit.id,
        sessionId: this.state.activeSession!.id,
      } as ExtractFromUnitPayload),
      priority: 'critical',
      max_attempts: 3,
    });

    logger.info('Queued extraction for unit', { unitId: unit.id, taskId });

    return { unit, taskId };
  }

  /**
   * Sanitize input text
   */
  private sanitizeText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .slice(0, 10000); // Limit length
  }

  // ==========================================================================
  // Task Handlers
  // ==========================================================================

  /**
   * Register handlers for different task types
   */
  private registerTaskHandlers(): void {
    // Main extraction handler
    this.queueRunner!.registerHandler<ExtractFromUnitPayload, PipelineOutput>(
      'extract_from_unit',
      {
        execute: async (payload, _checkpoint) => {
          return this.handleExtraction(payload);
        },
      }
    );

    logger.debug('Registered task handlers');
  }

  /**
   * Handle extraction task
   */
  private async handleExtraction(payload: ExtractFromUnitPayload): Promise<PipelineOutput> {
    const unit = this.store!.conversations.getById(payload.unitId);
    if (!unit) {
      throw new Error(`Conversation unit not found: ${payload.unitId}`);
    }

    // Build pipeline input
    const input: PipelineInput = {
      unit,
      precedingContext: this.buildPrecedingContext(payload.sessionId, unit.id),
      recentClaims: this.getRecentClaimsForPipeline(),
      activeChains: this.getActiveChainInfo(),
      knownEntities: this.getKnownEntityInfo(),
    };

    // Run extraction
    const result = await runExtractionPipeline(input);

    // Process results
    await this.processExtractionResults(unit, result);

    // Mark unit as processed
    this.store!.conversations.markProcessed(unit.id);

    // Update stats
    this.state.stats.totalUnitsProcessed++;
    this.state.stats.totalClaimsExtracted += result.claims.length;

    return result;
  }

  /**
   * Process extraction results - save claims, entities, update chains
   */
  private async processExtractionResults(
    unit: ConversationUnit,
    result: PipelineOutput
  ): Promise<void> {
    const savedClaims: Claim[] = [];

    // Get extractor IDs from pipeline results
    const extractorIds = result.extractorsRun;

    // Save claims
    for (const extractedClaim of result.claims) {
      const claim = this.store!.claims.create({
        statement: extractedClaim.statement,
        subject: extractedClaim.subject,
        claim_type: extractedClaim.claim_type,
        temporality: extractedClaim.temporality || 'slowly_decaying',
        abstraction: extractedClaim.abstraction || 'specific',
        source_type: extractedClaim.source_type || 'direct',
        initial_confidence: extractedClaim.confidence,
        emotional_valence: extractedClaim.emotional_valence || 0,
        emotional_intensity: extractedClaim.emotional_intensity || 0,
        stakes: extractedClaim.stakes || 'medium',
        valid_from: extractedClaim.valid_from || now(),
        valid_until: extractedClaim.valid_until || null,
        extraction_program_id: extractorIds[0] || 'unknown',
        elaborates: extractedClaim.elaborates || null,
        thought_chain_id: null,
        // Default values for required fields
        state: 'active',
        confirmation_count: 1,
        superseded_by: null,
      });

      // Link claim to conversation unit
      this.store!.claims.addSource({
        claim_id: claim.id,
        unit_id: unit.id,
      });

      // Assign to chain
      this.assignClaimToChain(claim);

      savedClaims.push(claim);
    }

    // Save entities
    for (const extractedEntity of result.entities) {
      const existing = this.store!.entities.getByName(extractedEntity.canonical_name);

      if (existing) {
        // Update existing entity
        this.store!.entities.incrementMentionCount(existing.id);
        this.store!.entities.updateLastReferenced(existing.id);
      } else {
        // Create new entity
        this.store!.entities.create({
          canonical_name: extractedEntity.canonical_name,
          entity_type: extractedEntity.entity_type,
          aliases: JSON.stringify(extractedEntity.aliases),
          mention_count: 1,
        });
      }
    }

    // Trigger observers for new claims
    if (savedClaims.length > 0 && this.dispatcher) {
      const results = await this.dispatcher.onNewClaims(
        savedClaims,
        this.state.activeSession!.id
      );
      this.state.stats.totalObserverRuns += results.length;
    }
  }

  /**
   * Assign a claim to an appropriate thought chain
   */
  private assignClaimToChain(claim: Claim): void {
    // Find matching chain or create new one
    const match = this.chainManager!.findMatchingChain(claim);

    if (match) {
      this.chainManager!.addClaimToChain(match.chainId, claim.id);
      this.store!.claims.update(claim.id, { thought_chain_id: match.chainId });
    } else {
      // Create new chain for this topic
      const chain = this.chainManager!.createChain(claim.subject);
      this.chainManager!.addClaimToChain(chain.id, claim.id);
      this.store!.claims.update(claim.id, { thought_chain_id: chain.id });
    }
  }

  // ==========================================================================
  // Context Building Helpers
  // ==========================================================================

  /**
   * Build summary of preceding context
   */
  private buildPrecedingContext(sessionId: string, excludeUnitId: string): string {
    const units = this.store!.conversations.getBySession(sessionId);
    const recent = units
      .filter((u) => u.id !== excludeUnitId && u.processed)
      .slice(-5);

    if (recent.length === 0) return '';

    return recent.map((u) => u.sanitized_text).join(' ');
  }

  /**
   * Get recent claims formatted for pipeline
   */
  private getRecentClaimsForPipeline(): PipelineInput['recentClaims'] {
    const claims = this.store!.claims.getRecent(10);
    return claims.map((c) => ({
      statement: c.statement,
      claim_type: c.claim_type,
      subject: c.subject,
    }));
  }

  /**
   * Get active chain info for pipeline
   */
  private getActiveChainInfo(): PipelineInput['activeChains'] {
    const chains = this.chainManager!.getActiveChainsByRecency().slice(0, 5);
    return chains.map((c) => ({
      id: c.id,
      topic: c.topic,
    }));
  }

  /**
   * Get known entity info for pipeline
   */
  private getKnownEntityInfo(): PipelineInput['knownEntities'] {
    const entities = this.store!.entities.getAll().slice(0, 20);
    return entities.map((e) => ({
      canonical_name: e.canonical_name,
      entity_type: e.entity_type,
    }));
  }

  // ==========================================================================
  // Query API
  // ==========================================================================

  /**
   * Get all claims
   */
  getClaims(): Claim[] {
    this.ensureInitialized();
    return this.store!.claims.getAll();
  }

  /**
   * Get claims by type
   */
  getClaimsByType(type: string): Claim[] {
    this.ensureInitialized();
    return this.store!.claims.getByType(type as Claim['claim_type']);
  }

  /**
   * Get all entities
   */
  getEntities(): Entity[] {
    this.ensureInitialized();
    return this.store!.entities.getAll();
  }

  /**
   * Get all thought chains
   */
  getChains(): ThoughtChain[] {
    this.ensureInitialized();
    return this.store!.chains.getAll();
  }

  /**
   * Get chain summaries
   */
  getChainSummaries() {
    this.ensureInitialized();
    return this.chainManager!.getChainSummaries();
  }

  /**
   * Get all goals
   */
  getGoals(): Goal[] {
    this.ensureInitialized();
    return this.store!.goals.getAll();
  }

  /**
   * Get goal tree
   */
  getGoalTree() {
    this.ensureInitialized();
    return this.goalManager!.buildGoalTree();
  }

  /**
   * Get detected patterns
   */
  getPatterns() {
    this.ensureInitialized();
    return this.store!.observerOutputs.getPatterns();
  }

  /**
   * Get detected contradictions
   */
  getContradictions() {
    this.ensureInitialized();
    return this.store!.observerOutputs.getContradictions();
  }

  /**
   * Get conversation units for the active session
   */
  getConversations(): ConversationUnit[] {
    this.ensureInitialized();
    if (!this.state.activeSession) return [];
    return this.store!.conversations.getBySession(this.state.activeSession.id);
  }

  /**
   * Get all tasks (for debugging)
   */
  getTasks() {
    this.ensureInitialized();
    return this.store!.tasks.getAll();
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return this.queueRunner?.getStatus() || {
      isRunning: false,
      activeTasks: 0,
      pendingTasks: 0,
      failedTasks: 0,
    };
  }

  /**
   * Get kernel state and stats
   */
  getState(): KernelState {
    if (this.state.initialized) {
      this.state.stats.uptime = now() - this.startTime;
    }
    return { ...this.state };
  }

  // ==========================================================================
  // Chain Manager API
  // ==========================================================================

  /**
   * Manually check chain dormancy
   */
  checkChainDormancy(): void {
    this.ensureInitialized();
    this.chainManager!.checkDormancy();
  }

  // ==========================================================================
  // Goal Manager API
  // ==========================================================================

  /**
   * Update goal progress
   */
  updateGoalProgress(goalId: string, value: number, reason: string) {
    this.ensureInitialized();
    return this.goalManager!.updateProgress(goalId, value, reason);
  }

  /**
   * Add milestone to goal
   */
  addMilestone(goalId: string, description: string) {
    this.ensureInitialized();
    return this.goalManager!.addMilestone(goalId, description);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.state.initialized) {
      throw new Error('Kernel not initialized. Call initialize() first.');
    }
  }

  private ensureActiveSession(): void {
    if (!this.state.activeSession) {
      throw new Error('No active session. Call startSession() first.');
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let kernelInstance: ProgramKernel | null = null;

/**
 * Get or create the kernel singleton
 */
export function getKernel(config?: Partial<KernelConfig>): ProgramKernel {
  if (!kernelInstance) {
    kernelInstance = new ProgramKernel(config);
  }
  return kernelInstance;
}

/**
 * Reset the kernel (for testing)
 */
export function resetKernel(): void {
  kernelInstance?.shutdown();
  kernelInstance = null;
}
