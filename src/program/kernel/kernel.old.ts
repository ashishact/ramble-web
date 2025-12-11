/**
 * Program Kernel
 *
 * The central orchestrator that ties together all program components:
 * - Store (TinyBase + IndexedDB)
 * - Queue Runner (durable task execution)
 * - Extraction Pipeline
 * - Goal Manager
 * - Observer Dispatcher
 *
 * Provides a unified API for the UI and external consumers.
 */

import { createProgramStore, type StoreBackend } from '../store/storeFactory';
import type { IProgramStore } from '../interfaces/store';
import { QueueRunner, createQueueRunner } from '../pipeline/queueRunner';
import { runExtractionPipeline, type PipelineInput, type PipelineOutput } from '../pipeline/extractionPipeline';
import { GoalManager, createGoalManager } from '../goals/goalManager';
import { ObserverDispatcher, createStandardDispatcher, type DispatcherStats } from '../observers';
import { CorrectionService, createCorrectionService, type ProcessTextResult } from '../corrections';
import { MemoryService, createMemoryService } from '../memory';
import { MigrationManager, createMigrationManager, ALL_MIGRATIONS, type MigrationStatus, type MigrationResult } from '../migrations';
import { syncAll, type SyncResult } from '../sync';
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
  Goal,
  ConversationSource,
  TopOfMind,
  MemoryStats,
  DecayResult,
  ExtractionProgramRecord,
} from '../types';

const logger = createLogger('Kernel');

// ============================================================================
// Kernel Configuration
// ============================================================================

export interface KernelConfig {
  /** Store backend to use: 'watermelon' (default) or 'tinybase' (legacy) */
  storeBackend: StoreBackend;
  /** Enable automatic observer execution */
  autoObservers: boolean;
  /** Maximum concurrent queue tasks */
  maxConcurrentTasks: number;
  /** Queue poll interval in ms */
  queuePollInterval: number;
  /** Enable debug logging */
  debug: boolean;
  /** Enable auto-learning of corrections from user statements */
  autoLearnCorrections: boolean;
  /** Enable auto-applying corrections to text */
  autoApplyCorrections: boolean;
  /** Minimum confidence for learning corrections (0-1) */
  correctionMinConfidence: number;
}

const DEFAULT_CONFIG: KernelConfig = {
  storeBackend: 'watermelon',
  autoObservers: true,
  maxConcurrentTasks: 3,
  queuePollInterval: 1000,
  debug: false,
  autoLearnCorrections: true,
  autoApplyCorrections: true,
  correctionMinConfidence: 0.7,
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

// Search & Replace types
export interface SearchResult {
  type: 'conversation' | 'claim' | 'entity' | 'goal';
  id: string;
  field: string;
  value: string;
  context: string;
}

export interface ReplaceResult {
  conversationsUpdated: number;
  claimsUpdated: number;
  entitiesUpdated: number;
  goalsUpdated: number;
  totalReplacements: number;
}

// ============================================================================
// Kernel Implementation
// ============================================================================

export class ProgramKernel {
  private config: KernelConfig;
  private store: IProgramStore | null = null;
  private queueRunner: QueueRunner | null = null;
  private goalManager: GoalManager | null = null;
  private dispatcher: ObserverDispatcher | null = null;
  private correctionService: CorrectionService | null = null;
  private memoryService: MemoryService | null = null;
  private migrationManager: MigrationManager | null = null;
  private decayIntervalId: ReturnType<typeof setInterval> | null = null;

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
      // Initialize store with configured backend
      logger.info('Initializing store', { backend: this.config.storeBackend });
      this.store = await createProgramStore({ backend: this.config.storeBackend });

      // Initialize managers
      this.goalManager = createGoalManager(this.store);
      this.dispatcher = createStandardDispatcher(this.store, {
        autoRun: this.config.autoObservers,
      });

      // Sync extractors and observers from code to database
      const syncResult = syncAll(this.store, this.dispatcher.getObservers());
      logger.info('Synced extractors and observers to database', syncResult);

      // Initialize correction service
      this.correctionService = createCorrectionService(this.store.corrections, {
        autoLearn: this.config.autoLearnCorrections,
        autoApply: this.config.autoApplyCorrections,
        minConfidence: this.config.correctionMinConfidence,
      });

      // Initialize memory service
      this.memoryService = createMemoryService(this.store);

      // Initialize migration manager
      this.migrationManager = createMigrationManager(this.store);
      // Register all migrations
      for (const migration of ALL_MIGRATIONS) {
        this.migrationManager.registerMigration(migration);
      }
      logger.info('Migration system initialized', {
        totalMigrations: ALL_MIGRATIONS.length,
      });

      // Initialize queue runner
      this.queueRunner = createQueueRunner(this.store, {
        maxConcurrent: this.config.maxConcurrentTasks,
        pollInterval: this.config.queuePollInterval,
      });

      // Register task handlers
      this.registerTaskHandlers();

      // Schedule periodic decay (every hour)
      this.schedulePeriodicDecay();

      // Check for active session
      this.state.activeSession = await this.store.sessions.getActive();

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

    // Stop periodic decay
    if (this.decayIntervalId) {
      clearInterval(this.decayIntervalId);
      this.decayIntervalId = null;
    }

    // Stop queue runner
    this.queueRunner?.stop();

    // End active session if any
    if (this.state.activeSession) {
      await this.store?.sessions.endSession(this.state.activeSession.id);
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
  async startSession(_metadata?: Record<string, unknown>): Promise<Session> {
    this.ensureInitialized();

    // End existing session if any
    if (this.state.activeSession) {
      await this.store!.sessions.endSession(this.state.activeSession.id);
    }

    const session = await this.store!.sessions.create({
      startedAt: now(),
      endedAt: null,
      unitCount: 0,
      summary: null,
      moodTrajectoryJson: null,
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
  ): Promise<{ unit: ConversationUnit; taskId: string; correctionResult?: ProcessTextResult }> {
    logger.info('processText called', { textLength: rawText.length, source });

    this.ensureInitialized();
    this.ensureActiveSession();

    // Basic sanitization first (trim, whitespace normalization)
    const basicSanitized = this.sanitizeText(rawText);

    // Only apply corrections to speech input (STT), not typed text
    let sanitizedText = basicSanitized;
    let correctionResult: ProcessTextResult | undefined;

    if (source === 'speech') {
      // Process through correction service (learns new corrections and applies stored ones)
      correctionResult = this.correctionService!.processText(basicSanitized);
      sanitizedText = correctionResult.correctedText;

      if (correctionResult.learnedNewCorrections) {
        logger.info('Learned new corrections', {
          count: correctionResult.newCorrections.length,
          corrections: correctionResult.newCorrections.map((c) => `${c.wrongText} → ${c.correctText}`),
        });
      }

      if (correctionResult.appliedCorrections.length > 0) {
        logger.info('Applied corrections to text', {
          count: correctionResult.appliedCorrections.length,
          changes: correctionResult.appliedCorrections.map((c) => `${c.originalWord} → ${c.replacedWith}`),
        });
      }
    }

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

    return { unit, taskId, correctionResult };
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

    // Decay claims handler
    this.queueRunner!.registerHandler<Record<string, never>, DecayResult>(
      'decay_claims',
      {
        execute: async () => {
          return this.memoryService!.runDecay();
        },
      }
    );

    logger.debug('Registered task handlers');
  }

  /**
   * Schedule periodic decay task
   */
  private schedulePeriodicDecay(): void {
    const DECAY_INTERVAL = 60 * 60 * 1000; // 1 hour

    // Run decay immediately on startup
    setTimeout(() => {
      if (this.state.initialized) {
        this.memoryService?.runDecay();
      }
    }, 5000); // Wait 5 seconds after startup

    // Schedule periodic decay
    this.decayIntervalId = setInterval(() => {
      if (this.state.initialized) {
        this.memoryService?.runDecay();
        logger.debug('Ran periodic decay');
      }
    }, DECAY_INTERVAL);

    logger.debug('Scheduled periodic decay', { intervalMs: DECAY_INTERVAL });
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
      knownEntities: this.getKnownEntityInfo(),
      store: this.store!,
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
        claim_type: extractedClaim.claimType,
        temporality: extractedClaim.temporality || 'slowly_decaying',
        abstraction: extractedClaim.abstraction || 'specific',
        source_type: extractedClaim.sourceType || 'direct',
        initial_confidence: extractedClaim.confidence,
        emotional_valence: extractedClaim.emotionalValence || 0,
        emotional_intensity: extractedClaim.emotionalIntensity || 0,
        stakes: extractedClaim.stakes || 'medium',
        valid_from: extractedClaim.validFrom || now(),
        valid_until: extractedClaim.validUntil || null,
        extraction_program_id: extractorIds[0] || 'unknown',
        elaborates: extractedClaim.elaborates || null,
        // Default values for required fields
        state: 'active',
        confirmation_count: 1,
        superseded_by: null,
        // Memory system defaults
        memory_tier: 'working',
        salience: 0,
        promoted_at: null,
      });

      // Save source tracking separately if available
      if (extractedClaim.sourceTracking) {
        this.store!.sourceTracking.create({
          claim_id: claim.id,
          unit_id: extractedClaim.sourceTracking.unitId,
          unit_text: extractedClaim.sourceTracking.unitText,
          text_excerpt: extractedClaim.sourceTracking.textExcerpt,
          char_start: extractedClaim.sourceTracking.charStart,
          char_end: extractedClaim.sourceTracking.charEnd,
          pattern_id: extractedClaim.sourceTracking.patternId,
          llm_prompt: extractedClaim.sourceTracking.llmPrompt || '',
          llm_response: extractedClaim.sourceTracking.llmResponse || '',
        });
      }

      // Link claim to conversation unit
      this.store!.claims.addSource({
        claim_id: claim.id,
        unit_id: unit.id,
      });

      savedClaims.push(claim);
    }

    // Save entities
    for (const extractedEntity of result.entities) {
      const existing = this.store!.entities.getByName(extractedEntity.canonicalName);

      if (existing) {
        // Update existing entity
        this.store!.entities.incrementMentionCount(existing.id);
        this.store!.entities.updateLastReferenced(existing.id);
      } else {
        // Create new entity
        this.store!.entities.create({
          canonical_name: extractedEntity.canonicalName,
          entity_type: extractedEntity.entityType,
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

    return recent.map((u) => u.sanitizedText).join(' ');
  }

  /**
   * Get recent claims formatted for pipeline
   */
  private getRecentClaimsForPipeline(): PipelineInput['recentClaims'] {
    const claims = this.store!.claims.getRecent(10);
    return claims.map((c) => ({
      statement: c.statement,
      claim_type: c.claimType,
      subject: c.subject,
    }));
  }

  /**
   * Get known entity info for pipeline
   */
  private getKnownEntityInfo(): PipelineInput['knownEntities'] {
    const entities = this.store!.entities.getAll().slice(0, 20);
    return entities.map((e) => ({
      canonical_name: e.canonicalName,
      entity_type: e.entityType,
    }));
  }

  // ==========================================================================
  // Query API
  // ==========================================================================

  /**
   * Get all claims
   */
  getClaims(limit?: number): Claim[] {
    this.ensureInitialized();
    const allClaims = this.store!.claims.getAll();
    if (limit === undefined) {
      return allClaims;
    }
    // Return last N claims (most recent)
    return allClaims.slice(-limit);
  }

  /**
   * Get total count of claims without loading them all
   */
  getClaimCount(): number {
    this.ensureInitialized();
    return this.store!.claims.count();
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
   * Get all conversation units across all sessions
   */
  getConversations(): ConversationUnit[] {
    this.ensureInitialized();
    return this.store!.conversations.getAll();
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
  // Correction Service API
  // ==========================================================================

  /**
   * Get all corrections
   */
  getCorrections() {
    this.ensureInitialized();
    return this.correctionService!.getAllCorrections();
  }

  /**
   * Get frequently used corrections
   */
  getFrequentCorrections(limit = 10) {
    this.ensureInitialized();
    return this.correctionService!.getFrequentCorrections(limit);
  }

  /**
   * Manually add a correction
   */
  addCorrection(wrongText: string, correctText: string) {
    this.ensureInitialized();
    return this.correctionService!.addCorrection(wrongText, correctText);
  }

  /**
   * Remove a correction
   */
  removeCorrection(id: string) {
    this.ensureInitialized();
    return this.correctionService!.removeCorrection(id);
  }

  /**
   * Get the correction service (for advanced use)
   */
  getCorrectionService() {
    this.ensureInitialized();
    return this.correctionService!;
  }

  // ==========================================================================
  // Memory Service API
  // ==========================================================================

  /**
   * Get working memory claims (high salience, recently active)
   */
  getWorkingMemory(): Claim[] {
    this.ensureInitialized();
    return this.memoryService!.getWorkingMemory();
  }

  /**
   * Get long-term memory claims (consolidated, stable)
   */
  getLongTermMemory(): Claim[] {
    this.ensureInitialized();
    return this.memoryService!.getLongTermMemory();
  }

  /**
   * Get top-of-mind snapshot
   */
  getTopOfMind(): TopOfMind {
    this.ensureInitialized();
    return this.memoryService!.getTopOfMind();
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    this.ensureInitialized();
    return this.memoryService!.getStats();
  }

  /**
   * Record access to a claim (boosts its salience temporarily)
   */
  recordMemoryAccess(claimId: string): void {
    this.ensureInitialized();
    this.memoryService!.recordAccess(claimId);
  }

  /**
   * Manually promote a claim to long-term memory
   */
  promoteToLongTerm(claimId: string, reason?: string): boolean {
    this.ensureInitialized();
    return this.memoryService!.promoteToLongTerm(claimId, reason);
  }

  /**
   * Manually run decay on all claims
   */
  runDecay(): DecayResult {
    this.ensureInitialized();
    return this.memoryService!.runDecay();
  }

  /**
   * Update salience for all active claims
   */
  updateAllSalience(): void {
    this.ensureInitialized();
    this.memoryService!.updateAllSalience();
  }

  /**
   * Get the memory service (for advanced use)
   */
  getMemoryService() {
    this.ensureInitialized();
    return this.memoryService!;
  }

  // ==========================================================================
  // Global Search & Replace API
  // ==========================================================================

  /**
   * Search for text across all stored data (fuzzy search)
   */
  searchText(query: string, options?: { caseSensitive?: boolean }): SearchResult[] {
    this.ensureInitialized();
    const results: SearchResult[] = [];
    const searchLower = options?.caseSensitive ? query : query.toLowerCase();

    // Search conversations (raw_text and sanitized_text)
    const conversations = this.store!.conversations.getAll();
    for (const conv of conversations) {
      const rawLower = options?.caseSensitive ? conv.rawText : conv.rawText.toLowerCase();
      const sanitizedLower = options?.caseSensitive ? conv.sanitizedText : conv.sanitizedText.toLowerCase();

      if (rawLower.includes(searchLower)) {
        results.push({
          type: 'conversation',
          id: conv.id,
          field: 'raw_text',
          value: conv.rawText,
          context: this.getContext(conv.rawText, query, options?.caseSensitive),
        });
      }
      if (sanitizedLower.includes(searchLower) && conv.sanitizedText !== conv.rawText) {
        results.push({
          type: 'conversation',
          id: conv.id,
          field: 'sanitized_text',
          value: conv.sanitizedText,
          context: this.getContext(conv.sanitizedText, query, options?.caseSensitive),
        });
      }
    }

    // Search claims (statement and subject)
    const claims = this.store!.claims.getAll();
    for (const claim of claims) {
      const stmtLower = options?.caseSensitive ? claim.statement : claim.statement.toLowerCase();
      const subjLower = options?.caseSensitive ? claim.subject : claim.subject.toLowerCase();

      if (stmtLower.includes(searchLower)) {
        results.push({
          type: 'claim',
          id: claim.id,
          field: 'statement',
          value: claim.statement,
          context: this.getContext(claim.statement, query, options?.caseSensitive),
        });
      }
      if (subjLower.includes(searchLower)) {
        results.push({
          type: 'claim',
          id: claim.id,
          field: 'subject',
          value: claim.subject,
          context: claim.subject,
        });
      }
    }

    // Search entities (canonical_name and aliases)
    const entities = this.store!.entities.getAll();
    for (const entity of entities) {
      const nameLower = options?.caseSensitive ? entity.canonicalName : entity.canonicalName.toLowerCase();

      if (nameLower.includes(searchLower)) {
        results.push({
          type: 'entity',
          id: entity.id,
          field: 'canonical_name',
          value: entity.canonicalName,
          context: entity.canonicalName,
        });
      }
      // Check aliases
      if (entity.aliases) {
        try {
          const aliases = JSON.parse(entity.aliases) as string[];
          for (const alias of aliases) {
            const aliasLower = options?.caseSensitive ? alias : alias.toLowerCase();
            if (aliasLower.includes(searchLower)) {
              results.push({
                type: 'entity',
                id: entity.id,
                field: 'aliases',
                value: alias,
                context: `Alias of ${entity.canonicalName}`,
              });
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Search goals (statement)
    const goals = this.store!.goals.getAll();
    for (const goal of goals) {
      const stmtLower = options?.caseSensitive ? goal.statement : goal.statement.toLowerCase();

      if (stmtLower.includes(searchLower)) {
        results.push({
          type: 'goal',
          id: goal.id,
          field: 'statement',
          value: goal.statement,
          context: this.getContext(goal.statement, query, options?.caseSensitive),
        });
      }
    }

    return results;
  }

  /**
   * Replace text across all stored data
   */
  replaceText(
    searchText: string,
    replaceText: string,
    options?: { caseSensitive?: boolean; addAsCorrection?: boolean }
  ): ReplaceResult {
    this.ensureInitialized();
    const result: ReplaceResult = {
      conversationsUpdated: 0,
      claimsUpdated: 0,
      entitiesUpdated: 0,
      goalsUpdated: 0,
      totalReplacements: 0,
    };

    const createRegex = () => new RegExp(
      searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      options?.caseSensitive ? 'g' : 'gi'
    );

    // Replace in conversations
    const conversations = this.store!.conversations.getAll();
    for (const conv of conversations) {
      const regex = createRegex();
      if (regex.test(conv.rawText)) {
        const newRaw = conv.rawText.replace(createRegex(), replaceText);
        this.store!.conversations.update(conv.id, { raw_text: newRaw });
        result.conversationsUpdated++;
        result.totalReplacements += (conv.rawText.match(createRegex()) || []).length;
      }

      const regex2 = createRegex();
      if (regex2.test(conv.sanitizedText)) {
        const newSanitized = conv.sanitizedText.replace(createRegex(), replaceText);
        this.store!.conversations.update(conv.id, { sanitized_text: newSanitized });
        if (!createRegex().test(conv.rawText)) {
          result.conversationsUpdated++;
        }
        result.totalReplacements += (conv.sanitizedText.match(createRegex()) || []).length;
      }
    }

    // Replace in claims
    const claims = this.store!.claims.getAll();
    for (const claim of claims) {
      let updated = false;
      const updates: { statement?: string; subject?: string } = {};

      const regex1 = createRegex();
      if (regex1.test(claim.statement)) {
        updates.statement = claim.statement.replace(createRegex(), replaceText);
        result.totalReplacements += (claim.statement.match(createRegex()) || []).length;
        updated = true;
      }

      const regex2 = createRegex();
      if (regex2.test(claim.subject)) {
        updates.subject = claim.subject.replace(createRegex(), replaceText);
        result.totalReplacements += (claim.subject.match(createRegex()) || []).length;
        updated = true;
      }

      if (updated) {
        this.store!.claims.update(claim.id, updates);
        result.claimsUpdated++;
      }
    }

    // Replace in entities
    const entities = this.store!.entities.getAll();
    for (const entity of entities) {
      let updated = false;
      const updates: { canonical_name?: string; aliases?: string } = {};

      const regex1 = createRegex();
      if (regex1.test(entity.canonicalName)) {
        updates.canonicalName = entity.canonicalName.replace(createRegex(), replaceText);
        result.totalReplacements += (entity.canonicalName.match(createRegex()) || []).length;
        updated = true;
      }

      if (entity.aliases) {
        try {
          const aliases = JSON.parse(entity.aliases) as string[];
          const newAliases = aliases.map(alias => {
            const regex = createRegex();
            if (regex.test(alias)) {
              result.totalReplacements += (alias.match(createRegex()) || []).length;
              updated = true;
              return alias.replace(createRegex(), replaceText);
            }
            return alias;
          });
          if (updated) {
            updates.aliases = JSON.stringify(newAliases);
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (updated) {
        this.store!.entities.update(entity.id, updates);
        result.entitiesUpdated++;
      }
    }

    // Replace in goals
    const goals = this.store!.goals.getAll();
    for (const goal of goals) {
      const regex = createRegex();
      if (regex.test(goal.statement)) {
        const newStatement = goal.statement.replace(createRegex(), replaceText);
        this.store!.goals.update(goal.id, { statement: newStatement });
        result.goalsUpdated++;
        result.totalReplacements += (goal.statement.match(createRegex()) || []).length;
      }
    }

    // Optionally add as a correction for future STT
    if (options?.addAsCorrection) {
      this.correctionService!.addCorrection(searchText, replaceText);
    }

    logger.info('Global replace completed', result);
    return result;
  }

  /**
   * Get context snippet around a match
   */
  private getContext(text: string, query: string, caseSensitive?: boolean): string {
    const lowerText = caseSensitive ? text : text.toLowerCase();
    const lowerQuery = caseSensitive ? query : query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return text.slice(0, 60);

    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + query.length + 20);
    let context = text.slice(start, end);
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    return context;
  }

  // ==========================================================================
  // Extractors & Observers Management
  // ==========================================================================

  /**
   * Get all extraction programs
   */
  getExtractionPrograms(): ExtractionProgramRecord[] {
    this.ensureInitialized();
    return this.store!.extractionPrograms.getAll();
  }

  /**
   * Toggle extractor active status
   */
  toggleExtractor(id: string, active: boolean): ExtractionProgramRecord | null {
    this.ensureInitialized();
    return this.store!.extractionPrograms.update(id, { active });
  }

  /**
   * Get registered observer types
   */
  getRegisteredObservers(): Array<{ type: string; name: string; description: string; active: boolean }> {
    this.ensureInitialized();
    const observerTypes = this.dispatcher!.getRegisteredObservers();

    // Get observer configs from the dispatcher's registered observers
    const observers = observerTypes.map(type => {
      const observer = (this.dispatcher as any).observers.get(type);
      return {
        type: observer.config.type,
        name: observer.config.name,
        description: observer.config.description,
        active: true, // Currently all registered observers are active
      };
    });

    return observers;
  }

  /**
   * Toggle observer (enable/disable by registering/unregistering)
   */
  toggleObserver(observerType: string, active: boolean): boolean {
    this.ensureInitialized();

    if (active) {
      // Re-register observer - need to recreate it
      // For now, this is not supported as observers are registered at startup
      logger.warn('Re-registering observers is not yet supported', { observerType });
      return false;
    } else {
      // Unregister observer
      this.dispatcher!.unregister(observerType);
      logger.info('Observer disabled', { observerType });
      return true;
    }
  }

  /**
   * Get observer dispatcher stats
   */
  getObserverStats(): DispatcherStats {
    this.ensureInitialized();
    return this.dispatcher!.getStats();
  }

  // ==========================================================================
  // Sync Management
  // ==========================================================================

  /**
   * Sync extractors and observers from code to database
   */
  syncPrograms(): SyncResult {
    this.ensureInitialized();
    const result = syncAll(this.store!, this.dispatcher!.getObservers());
    logger.info('Synced programs', result);
    return result;
  }

  /**
   * Get all observer programs from database
   */
  getObserverPrograms() {
    this.ensureInitialized();
    return this.store!.observerPrograms.getAll();
  }

  // ==========================================================================
  // Migrations
  // ==========================================================================

  /**
   * Get migration status
   */
  getMigrationStatus(): MigrationStatus {
    this.ensureInitialized();
    return this.migrationManager!.getStatus();
  }

  /**
   * Run a specific migration
   */
  async runMigration(version: number): Promise<MigrationResult> {
    this.ensureInitialized();
    return this.migrationManager!.runMigration(version);
  }

  /**
   * Run all pending migrations
   */
  async runAllPendingMigrations(): Promise<MigrationResult[]> {
    this.ensureInitialized();
    return this.migrationManager!.runAllPending();
  }

  /**
   * Rollback a migration (if supported)
   */
  async rollbackMigration(version: number): Promise<MigrationResult> {
    this.ensureInitialized();
    return this.migrationManager!.rollbackMigration(version);
  }

  /**
   * Get the underlying store instance (for direct access)
   */
  getStore(): ProgramStoreInstance {
    this.ensureInitialized();
    return this.store!;
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
