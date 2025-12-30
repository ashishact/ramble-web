/**
 * Program Kernel
 *
 * Singleton orchestrator - initializes ONCE at app startup (not in React).
 * Uses queue-based pipeline for processing.
 */

import { createProgramStore, type StoreBackend } from '../store/storeFactory'
import type { IProgramStore } from '../interfaces/store'
import { getPipelineQueue } from '../pipeline/pipelineQueue'
import type { Proposition, Stance, Relation, EntityMention, Span } from '../schemas/primitives'
import { GoalManager, createGoalManager } from '../goals/goalManager'
import { ObserverDispatcher, createStandardDispatcher, type DispatcherStats } from '../observers'
import { CorrectionService, createCorrectionService, type ProcessTextResult } from '../corrections'
import { MemoryService, createMemoryService } from '../memory'
import { VocabularyService, createVocabularyService, type CanonicalSuggestion } from '../services/vocabularyService'
import type { Vocabulary, VocabularyEntityType } from '../schemas/vocabulary'
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
  debug: boolean
  autoLearnCorrections: boolean
  autoApplyCorrections: boolean
  correctionMinConfidence: number
}

const DEFAULT_CONFIG: KernelConfig = {
  storeBackend: 'watermelon',
  autoObservers: true,
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
  stats: KernelStats
}

export interface KernelStats {
  totalUnitsProcessed: number
  totalClaimsExtracted: number
  uptime: number
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

  // Other services
  private goalManager: GoalManager | null = null
  private dispatcher: ObserverDispatcher | null = null
  private correctionService: CorrectionService | null = null
  private memoryService: MemoryService | null = null
  private vocabularyService: VocabularyService | null = null
  private migrationManager: MigrationManager | null = null
  private decayIntervalId: ReturnType<typeof setInterval> | null = null

  private state: KernelState = {
    initialized: false,
    activeSession: null,
    stats: {
      totalUnitsProcessed: 0,
      totalClaimsExtracted: 0,
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

      // Initialize pipeline queue (singleton)
      getPipelineQueue().initialize(this.store)

      // Initialize managers
      this.goalManager = createGoalManager(this.store)
      this.dispatcher = createStandardDispatcher(this.store, {
        autoRun: this.config.autoObservers,
      })

      // Sync extractors and observers
      const syncResult = await syncAll(this.store, this.dispatcher.getObservers())
      logger.info('Synced extractors and observers', syncResult)

      // Initialize correction service
      this.correctionService = createCorrectionService(this.store.corrections, {
        autoLearn: this.config.autoLearnCorrections,
        autoApply: this.config.autoApplyCorrections,
        minConfidence: this.config.correctionMinConfidence,
      })

      // Initialize memory service
      this.memoryService = createMemoryService(this.store)

      // Initialize vocabulary service
      this.vocabularyService = createVocabularyService(this.store.vocabulary, this.store.entities)

      // Initialize migration manager
      this.migrationManager = createMigrationManager(this.store)
      for (const migration of ALL_MIGRATIONS) {
        this.migrationManager.registerMigration(migration)
      }

      // Schedule periodic decay
      this.schedulePeriodicDecay()

      // Initialize specialized services
      this.sessionManager = createSessionManager(this.store)
      await this.sessionManager.initialize()

      this.conversationProcessor = createConversationProcessor(
        this.store,
        this.correctionService
      )

      this.queryService = createQueryService(this.store, this.goalManager)
      this.searchService = createSearchService(this.store)

      // Check for active session
      this.state.activeSession = this.sessionManager.getActiveSession()

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

    if (this.decayIntervalId) {
      clearInterval(this.decayIntervalId)
      this.decayIntervalId = null
    }

    await this.sessionManager?.endSession()

    this.state.initialized = false
    logger.info('Program Kernel shut down')
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  async startSession(metadata?: Record<string, unknown>): Promise<Session> {
    this.ensureInitialized()
    const session = await this.sessionManager!.startSession(metadata)
    this.state.activeSession = session
    return session
  }

  async endSession(): Promise<void> {
    this.ensureInitialized()
    if (!this.state.activeSession) return

    await this.dispatcher?.onSessionEnd(this.state.activeSession.id)
    await this.sessionManager!.endSession()
    this.state.activeSession = null
  }

  getActiveSession(): Session | null {
    return this.sessionManager?.getActiveSession() || null
  }

  // ==========================================================================
  // Conversation Processing
  // ==========================================================================

  async processText(
    rawText: string,
    source: ConversationSource,
    metadata?: Record<string, unknown>
  ): Promise<{ unit: ConversationUnit; correctionResult?: ProcessTextResult }> {
    this.ensureInitialized()
    this.sessionManager!.ensureActiveSession()

    const result = await this.conversationProcessor!.processText(
      rawText,
      source,
      this.state.activeSession!.id,
      metadata
    )

    await this.sessionManager!.incrementUnitCount()
    return result
  }

  // ==========================================================================
  // Pipeline Queue
  // ==========================================================================

  async getQueueStatus() {
    return getPipelineQueue().getStatus()
  }

  subscribeToPipelineEvents(listener: (event: unknown) => void): () => void {
    return getPipelineQueue().subscribe(listener)
  }

  // ==========================================================================
  // Query API
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
  // Search & Replace
  // ==========================================================================

  async searchText(query: string, options?: { caseSensitive?: boolean }): Promise<SearchResult[]> {
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

    if (options?.addAsCorrection) {
      await this.correctionService!.addCorrection(searchText, replaceText)
    }

    return result
  }

  // ==========================================================================
  // Goal Manager API
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
  // Correction Service API
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
  // Memory Service API
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
  // Vocabulary Service API
  // ==========================================================================

  async getVocabulary(): Promise<Vocabulary[]> {
    this.ensureInitialized()
    return await this.vocabularyService!.getAll()
  }

  async getVocabularyById(id: string): Promise<Vocabulary | null> {
    this.ensureInitialized()
    return await this.vocabularyService!.getById(id)
  }

  async getFrequentVocabulary(limit?: number): Promise<Vocabulary[]> {
    this.ensureInitialized()
    return await this.vocabularyService!.getFrequentlyUsed(limit)
  }

  async addVocabulary(data: {
    correctSpelling: string
    entityType: VocabularyEntityType
    contextHints?: string[]
    sourceEntityId?: string
  }): Promise<Vocabulary> {
    this.ensureInitialized()
    return await this.vocabularyService!.addVocabulary(data)
  }

  async correctCanonical(vocabId: string, newCanonical: string): Promise<Vocabulary | null> {
    this.ensureInitialized()
    return await this.vocabularyService!.correctCanonical(vocabId, newCanonical)
  }

  async updateVocabularyContextHints(id: string, hints: string[]): Promise<Vocabulary | null> {
    this.ensureInitialized()
    return await this.vocabularyService!.updateContextHints(id, hints)
  }

  async deleteVocabulary(id: string): Promise<boolean> {
    this.ensureInitialized()
    return await this.vocabularyService!.deleteVocabulary(id)
  }

  async getCanonicalSuggestions(): Promise<CanonicalSuggestion[]> {
    this.ensureInitialized()
    return await this.vocabularyService!.getCanonicalSuggestions()
  }

  async applyCanonicalSuggestion(suggestion: CanonicalSuggestion): Promise<Vocabulary | null> {
    this.ensureInitialized()
    return await this.vocabularyService!.applySuggestion(suggestion)
  }

  async syncVocabularyFromEntities(): Promise<number> {
    this.ensureInitialized()
    return await this.vocabularyService!.syncFromEntities()
  }

  async getVocabularyStats(): Promise<{
    totalEntries: number
    entriesWithSuggestions: number
    totalVariants: number
    averageVariantsPerEntry: number
  }> {
    this.ensureInitialized()
    return await this.vocabularyService!.getStats()
  }

  getVocabularyService(): VocabularyService {
    this.ensureInitialized()
    return this.vocabularyService!
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
  // Internal Scheduling
  // ==========================================================================

  private schedulePeriodicDecay(): void {
    const DECAY_INTERVAL = 60 * 60 * 1000 // 1 hour

    setTimeout(() => {
      if (this.state.initialized) {
        this.memoryService?.runDecay()
      }
    }, 5000)

    this.decayIntervalId = setInterval(() => {
      if (this.state.initialized) {
        this.memoryService?.runDecay()
      }
    }, DECAY_INTERVAL)
  }

  private ensureInitialized(): void {
    if (!this.state.initialized) {
      throw new Error('Kernel not initialized. Call initialize() first.')
    }
  }
}

// ============================================================================
// Singleton Factory
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
