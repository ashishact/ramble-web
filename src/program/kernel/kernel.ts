/**
 * Program Kernel - Refactored
 *
 * Slim orchestrator that delegates to specialized services:
 * - SessionManager: Session lifecycle
 * - ConversationProcessor: Text processing
 * - QueryService: Read operations
 * - SearchService: Search & replace
 * - Store: Data persistence (WatermelonDB/TinyBase)
 * - QueueRunner: Task execution
 * - Services: Goals, Corrections, Memory, Observers, Migrations
 */

import { createProgramStore, type StoreBackend } from '../store/storeFactory'
import type { IProgramStore } from '../interfaces/store'
import { QueueRunner, createQueueRunner } from '../pipeline/queueRunner'
import { runPrimitivePipeline, type PrimitivePipelineOutput } from '../pipeline/primitivePipeline'
import type { Proposition, Stance, Relation, EntityMention, Span } from '../schemas/primitives'
import { GoalManager, createGoalManager } from '../goals/goalManager'
import { ObserverDispatcher, createStandardDispatcher, type DispatcherStats } from '../observers'
import { CorrectionService, createCorrectionService, type ProcessTextResult } from '../corrections'
import { MemoryService, createMemoryService } from '../memory'
import {
  MigrationManager,
  createMigrationManager,
  ALL_MIGRATIONS,
  type MigrationStatus,
  type MigrationResult,
} from '../migrations'
import { syncAll, type SyncResult } from '../sync'
import { createLogger } from '../utils/logger'
import { now } from '../utils/time'

// Specialized services
import { SessionManager, createSessionManager } from './sessionManager'
import { ConversationProcessor, createConversationProcessor } from './conversationProcessor'
import { QueryService, createQueryService } from './queryService'
import { SearchService, createSearchService, type SearchResult, type ReplaceResult } from './searchService'

import type {
  Session,
  ConversationUnit,
  ConversationSource,
  Claim,
  Entity,
  Goal,
  TopOfMind,
  MemoryStats,
  DecayResult,
  ExtractionProgramRecord,
} from '../types'

const logger = createLogger('Kernel')

// ============================================================================
// Kernel Configuration
// ============================================================================

export interface KernelConfig {
  storeBackend: StoreBackend
  autoObservers: boolean
  maxConcurrentTasks: number
  queuePollInterval: number
  debug: boolean
  autoLearnCorrections: boolean
  autoApplyCorrections: boolean
  correctionMinConfidence: number
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
}

// ============================================================================
// Kernel State
// ============================================================================

export interface KernelState {
  initialized: boolean
  activeSession: Session | null
  queueRunning: boolean
  stats: KernelStats
}

export interface KernelStats {
  totalUnitsProcessed: number
  totalClaimsExtracted: number
  totalObserverRuns: number
  uptime: number
}

interface ExtractFromUnitPayload {
  unitId: string
  sessionId: string
}

// ============================================================================
// Kernel Implementation
// ============================================================================

export class ProgramKernel {
  private config: KernelConfig
  private store: IProgramStore | null = null

  // Core services
  private sessionManager: SessionManager | null = null
  private conversationProcessor: ConversationProcessor | null = null
  private queryService: QueryService | null = null
  private searchService: SearchService | null = null

  // Existing services
  private queueRunner: QueueRunner | null = null
  private goalManager: GoalManager | null = null
  private dispatcher: ObserverDispatcher | null = null
  private correctionService: CorrectionService | null = null
  private memoryService: MemoryService | null = null
  private migrationManager: MigrationManager | null = null
  private decayIntervalId: ReturnType<typeof setInterval> | null = null

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
  }

  private startTime: number = 0

  constructor(config?: Partial<KernelConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.state.initialized) {
      logger.warn('Kernel already initialized')
      return
    }

    logger.info('Initializing Program Kernel...')
    this.startTime = now()

    try {
      // Initialize store
      logger.info('Initializing store', { backend: this.config.storeBackend })
      this.store = await createProgramStore({ backend: this.config.storeBackend })

      // Initialize managers
      this.goalManager = createGoalManager(this.store)
      this.dispatcher = createStandardDispatcher(this.store, {
        autoRun: this.config.autoObservers,
      })

      // Sync extractors and observers
      const syncResult = await syncAll(this.store, this.dispatcher.getObservers())
      logger.info('Synced extractors and observers to database', syncResult)

      // Initialize correction service
      this.correctionService = createCorrectionService(this.store.corrections, {
        autoLearn: this.config.autoLearnCorrections,
        autoApply: this.config.autoApplyCorrections,
        minConfidence: this.config.correctionMinConfidence,
      })

      // Initialize memory service
      this.memoryService = createMemoryService(this.store)

      // Initialize migration manager
      this.migrationManager = createMigrationManager(this.store)
      for (const migration of ALL_MIGRATIONS) {
        this.migrationManager.registerMigration(migration)
      }

      // Initialize queue runner
      this.queueRunner = createQueueRunner(this.store, {
        maxConcurrent: this.config.maxConcurrentTasks,
        pollInterval: this.config.queuePollInterval,
      })

      // Register task handlers
      this.registerTaskHandlers()

      // Schedule periodic decay
      this.schedulePeriodicDecay()

      // Initialize specialized services
      this.sessionManager = createSessionManager(this.store)
      await this.sessionManager.initialize()

      this.conversationProcessor = createConversationProcessor(
        this.store,
        this.queueRunner,
        this.correctionService
      )

      this.queryService = createQueryService(this.store, this.goalManager)
      this.searchService = createSearchService(this.store)

      // Check for active session
      this.state.activeSession = this.sessionManager.getActiveSession()

      // Always start queue runner for durable execution
      // It will process any pending tasks from previous sessions
      logger.info('Starting queue runner for durable execution...')
      this.queueRunner.start()
      this.state.queueRunning = true

      if (this.state.activeSession) {
        logger.info('Found active session:', this.state.activeSession.id)
      }

      this.state.initialized = true
      logger.info('Program Kernel initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize kernel', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      throw error
    }
  }

  async shutdown(): Promise<void> {
    if (!this.state.initialized) return

    logger.info('Shutting down Program Kernel...')

    // Stop periodic decay
    if (this.decayIntervalId) {
      clearInterval(this.decayIntervalId)
      this.decayIntervalId = null
    }

    // Stop queue runner
    this.queueRunner?.stop()

    // End active session
    await this.sessionManager?.endSession()

    this.state.initialized = false
    logger.info('Program Kernel shut down')
  }

  // ==========================================================================
  // Session Management (Delegated)
  // ==========================================================================

  async startSession(metadata?: Record<string, unknown>): Promise<Session> {
    this.ensureInitialized()
    const session = await this.sessionManager!.startSession(metadata)
    this.state.activeSession = session

    // Start queue processing
    this.queueRunner!.start()
    this.state.queueRunning = true

    return session
  }

  async endSession(): Promise<void> {
    this.ensureInitialized()

    if (!this.state.activeSession) return

    // Trigger session_end observers
    await this.dispatcher?.onSessionEnd(this.state.activeSession.id)

    await this.sessionManager!.endSession()
    this.state.activeSession = null

    // Stop queue runner
    this.queueRunner!.stop()
    this.state.queueRunning = false
  }

  getActiveSession(): Session | null {
    return this.sessionManager?.getActiveSession() || null
  }

  // ==========================================================================
  // Conversation Processing (Delegated)
  // ==========================================================================

  async processText(
    rawText: string,
    source: ConversationSource,
    metadata?: Record<string, unknown>
  ): Promise<{ unit: ConversationUnit; taskId: string; correctionResult?: ProcessTextResult }> {
    this.ensureInitialized()
    this.sessionManager!.ensureActiveSession()

    const result = await this.conversationProcessor!.processText(
      rawText,
      source,
      this.state.activeSession!.id,
      metadata
    )

    // Increment session unit count
    await this.sessionManager!.incrementUnitCount()

    return result
  }

  // ==========================================================================
  // Query API (Delegated)
  // ==========================================================================

  async getClaims(limit?: number): Promise<Claim[]> {
    this.ensureInitialized()
    return this.queryService!.getClaims(limit)
  }

  async getClaimCount(): Promise<number> {
    this.ensureInitialized()
    return this.queryService!.getClaimCount()
  }

  async getClaimsByType(type: string): Promise<Claim[]> {
    this.ensureInitialized()
    return this.queryService!.getClaimsByType(type)
  }

  async getEntities(): Promise<Entity[]> {
    this.ensureInitialized()
    return this.queryService!.getEntities()
  }

  async getPropositions(): Promise<Proposition[]> {
    this.ensureInitialized()
    return this.store!.propositions.getRecent(100)
  }

  async getStances(): Promise<Stance[]> {
    this.ensureInitialized()
    return this.store!.stances.getRecent(100)
  }

  async getRelations(): Promise<Relation[]> {
    this.ensureInitialized()
    return this.queryService!.getRelations()
  }

  async getEntityMentions(): Promise<EntityMention[]> {
    this.ensureInitialized()
    return this.queryService!.getEntityMentions()
  }

  async getSpans(): Promise<Span[]> {
    this.ensureInitialized()
    return this.queryService!.getSpans()
  }

  async getGoals(): Promise<Goal[]> {
    this.ensureInitialized()
    return this.queryService!.getGoals()
  }

  async getGoalTree() {
    this.ensureInitialized()
    return this.queryService!.getGoalTree()
  }

  async getPatterns() {
    this.ensureInitialized()
    return this.queryService!.getPatterns()
  }

  async getContradictions() {
    this.ensureInitialized()
    return this.queryService!.getContradictions()
  }

  async getConversations(): Promise<ConversationUnit[]> {
    this.ensureInitialized()
    return this.queryService!.getConversations()
  }

  async getTasks() {
    this.ensureInitialized()
    return this.queryService!.getTasks()
  }

  async getExtractionPrograms(): Promise<ExtractionProgramRecord[]> {
    this.ensureInitialized()
    return this.queryService!.getExtractionPrograms()
  }

  async getObserverPrograms() {
    this.ensureInitialized()
    return this.queryService!.getObserverPrograms()
  }

  // ==========================================================================
  // Search & Replace (Delegated)
  // ==========================================================================

  async searchText(
    query: string,
    options?: { caseSensitive?: boolean }
  ): Promise<SearchResult[]> {
    this.ensureInitialized()
    return this.searchService!.searchText(query, options)
  }

  async replaceText(
    searchText: string,
    replaceText: string,
    options?: { caseSensitive?: boolean; addAsCorrection?: boolean }
  ): Promise<ReplaceResult> {
    this.ensureInitialized()
    const result = await this.searchService!.replaceText(searchText, replaceText, options)

    // Optionally add as a correction
    if (options?.addAsCorrection) {
      await this.correctionService!.addCorrection(searchText, replaceText)
    }

    return result
  }

  // ==========================================================================
  // Goal Manager API (Pass-through)
  // ==========================================================================

  async updateGoalProgress(goalId: string, value: number, reason: string) {
    this.ensureInitialized()
    return await this.goalManager!.updateProgress(goalId, value, reason)
  }

  async addMilestone(goalId: string, description: string) {
    this.ensureInitialized()
    return await this.goalManager!.addMilestone(goalId, description)
  }

  // ==========================================================================
  // Correction Service API (Pass-through)
  // ==========================================================================

  async getCorrections() {
    this.ensureInitialized()
    return await this.correctionService!.getAllCorrections()
  }

  async getFrequentCorrections(limit = 10) {
    this.ensureInitialized()
    return await this.correctionService!.getFrequentCorrections(limit)
  }

  async addCorrection(wrongText: string, correctText: string) {
    this.ensureInitialized()
    return await this.correctionService!.addCorrection(wrongText, correctText)
  }

  async removeCorrection(id: string) {
    this.ensureInitialized()
    return await this.correctionService!.removeCorrection(id)
  }

  getCorrectionService() {
    this.ensureInitialized()
    return this.correctionService!
  }

  // ==========================================================================
  // Memory Service API (Pass-through)
  // ==========================================================================

  async getWorkingMemory(): Promise<Claim[]> {
    this.ensureInitialized()
    return await this.memoryService!.getWorkingMemory()
  }

  async getLongTermMemory(): Promise<Claim[]> {
    this.ensureInitialized()
    return await this.memoryService!.getLongTermMemory()
  }

  async getTopOfMind(): Promise<TopOfMind> {
    this.ensureInitialized()
    return await this.memoryService!.getTopOfMind()
  }

  async getMemoryStats(): Promise<MemoryStats> {
    this.ensureInitialized()
    return await this.memoryService!.getStats()
  }

  async recordMemoryAccess(claimId: string): Promise<void> {
    this.ensureInitialized()
    await this.memoryService!.recordAccess(claimId)
  }

  async promoteToLongTerm(claimId: string, reason?: string): Promise<boolean> {
    this.ensureInitialized()
    return await this.memoryService!.promoteToLongTerm(claimId, reason)
  }

  async runDecay(): Promise<DecayResult> {
    this.ensureInitialized()
    return await this.memoryService!.runDecay()
  }

  async updateAllSalience(): Promise<void> {
    this.ensureInitialized()
    await this.memoryService!.updateAllSalience()
  }

  getMemoryService() {
    this.ensureInitialized()
    return this.memoryService!
  }

  // ==========================================================================
  // Observer & Extractor Management
  // ==========================================================================

  async toggleExtractor(id: string, active: boolean): Promise<ExtractionProgramRecord | null> {
    this.ensureInitialized()
    return await this.store!.extractionPrograms.update(id, { active })
  }

  getRegisteredObservers(): Array<{
    type: string
    name: string
    description: string
    active: boolean
  }> {
    this.ensureInitialized()
    const observerTypes = this.dispatcher!.getRegisteredObservers()

    return observerTypes.map((type) => {
      const observer = (this.dispatcher as any).observers.get(type)
      return {
        type: observer.config.type,
        name: observer.config.name,
        description: observer.config.description,
        active: true,
      }
    })
  }

  toggleObserver(observerType: string, active: boolean): boolean {
    this.ensureInitialized()

    if (!active) {
      this.dispatcher!.unregister(observerType)
      return true
    }

    logger.warn('Re-registering observers is not yet supported', { observerType })
    return false
  }

  getObserverStats(): DispatcherStats {
    this.ensureInitialized()
    return this.dispatcher!.getStats()
  }

  // ==========================================================================
  // Migrations
  // ==========================================================================

  getMigrationStatus(): MigrationStatus {
    this.ensureInitialized()
    return this.migrationManager!.getStatus()
  }

  async runMigration(version: number): Promise<MigrationResult> {
    this.ensureInitialized()
    return await this.migrationManager!.runMigration(version)
  }

  async runAllPendingMigrations(): Promise<MigrationResult[]> {
    this.ensureInitialized()
    return await this.migrationManager!.runAllPending()
  }

  async rollbackMigration(version: number): Promise<MigrationResult> {
    this.ensureInitialized()
    return await this.migrationManager!.rollbackMigration(version)
  }

  // ==========================================================================
  // Sync
  // ==========================================================================

  async syncPrograms(): Promise<SyncResult> {
    this.ensureInitialized()
    const result = await syncAll(this.store!, this.dispatcher!.getObservers())
    logger.info('Synced programs', result)
    return result
  }

  // ==========================================================================
  // State & Status
  // ==========================================================================

  async getQueueStatus() {
    if (this.queueRunner) {
      return await this.queueRunner.getStatus()
    }
    return {
      isRunning: false,
      activeTasks: 0,
      pendingTasks: 0,
      failedTasks: 0,
    }
  }

  getState(): KernelState {
    if (this.state.initialized) {
      this.state.stats.uptime = now() - this.startTime
    }
    return { ...this.state }
  }

  getStore(): IProgramStore {
    this.ensureInitialized()
    return this.store!
  }

  // ==========================================================================
  // Task Handlers
  // ==========================================================================

  private registerTaskHandlers(): void {
    this.queueRunner!.registerHandler<ExtractFromUnitPayload, PrimitivePipelineOutput>(
      'extract_from_unit',
      {
        execute: async (payload, _checkpoint) => {
          return this.handleExtraction(payload)
        },
      }
    )

    this.queueRunner!.registerHandler<Record<string, never>, DecayResult>('decay_claims', {
      execute: async () => {
        return await this.memoryService!.runDecay()
      },
    })
  }

  private async handleExtraction(payload: ExtractFromUnitPayload): Promise<PrimitivePipelineOutput> {
    const unit = await this.store!.conversations.getById(payload.unitId)
    if (!unit) {
      throw new Error(`Conversation unit not found: ${payload.unitId}`)
    }

    // Run primitive pipeline (extracts primitives + derives claims)
    // Flow: ConversationUnit → Span → Proposition + Stance → Claim
    const result = await runPrimitivePipeline({
      unit,
      store: this.store!,
    })

    logger.info('Primitive pipeline completed', {
      propositions: result.propositions.length,
      stances: result.stances.length,
      claims: result.claims.length,
      entities: result.entities.length,
      processingTimeMs: result.metadata.processingTimeMs,
    })

    // Trigger observers on new claims
    if (this.dispatcher && result.claims.length > 0) {
      await this.dispatcher.dispatch({
        type: 'new_claim',
        claims: result.claims,
        sessionId: unit.sessionId,
        timestamp: Date.now(),
      })
    }

    // Update stats
    this.state.stats.totalUnitsProcessed++
    this.state.stats.totalClaimsExtracted += result.claims.length

    return result
  }

  private schedulePeriodicDecay(): void {
    const DECAY_INTERVAL = 60 * 60 * 1000 // 1 hour

    // Run decay after startup
    setTimeout(() => {
      if (this.state.initialized) {
        this.memoryService?.runDecay()
      }
    }, 5000)

    // Schedule periodic decay
    this.decayIntervalId = setInterval(() => {
      if (this.state.initialized) {
        this.memoryService?.runDecay()
      }
    }, DECAY_INTERVAL)
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.state.initialized) {
      throw new Error('Kernel not initialized. Call initialize() first.')
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

let kernelInstance: ProgramKernel | null = null

export function getKernel(config?: Partial<KernelConfig>): ProgramKernel {
  if (!kernelInstance) {
    kernelInstance = new ProgramKernel(config)
  }
  return kernelInstance
}

export function resetKernel(): void {
  kernelInstance?.shutdown()
  kernelInstance = null
}
