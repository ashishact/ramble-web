/**
 * Pipeline Queue - Simple Sequential Processor
 *
 * - Queue processes ONE unit at a time
 * - All flow control in code (no event-driven triggers)
 * - Events are NOTIFICATIONS ONLY for UI
 * - Task DB stores progress for durability
 * - On crash/reload, resume from last completed step
 */

import type { IProgramStore } from '../interfaces/store'
import type { ConversationUnit, Task } from '../types'
import type { CreateEntityMention } from '../schemas/primitives'
import { extractPrimitives, type PrimitiveExtractionInput } from '../extractors/primitiveExtractor'
import { resolveEntities } from './entityResolver'
import { deriveClaim } from './claimDeriver'
import { findPatternMatches } from '../extractors/patternMatcher'
import { extractorRegistry } from '../extractors/registry'
import { createLogger } from '../utils/logger'
import { now } from '../utils/time'

const logger = createLogger('PipelineQueue')

// ============================================================================
// Pipeline Steps
// ============================================================================

export type PipelineStep =
  | 'pending'
  | 'preprocess'
  | 'extract'
  | 'resolve'
  | 'derive'
  | 'complete'

const STEP_ORDER: PipelineStep[] = ['pending', 'preprocess', 'extract', 'resolve', 'derive', 'complete']

// ============================================================================
// Event Emitter (Notifications Only - Does NOT trigger anything)
// ============================================================================

export type PipelineEventType =
  | 'queue:item_added'
  | 'queue:processing_started'
  | 'queue:step_started'
  | 'queue:step_completed'
  | 'queue:item_completed'
  | 'queue:item_failed'
  | 'queue:idle'

export interface PipelineEvent {
  type: PipelineEventType
  unitId?: string
  step?: PipelineStep
  timestamp: number
  data?: Record<string, unknown>
}

type EventListener = (event: PipelineEvent) => void

class PipelineEventEmitter {
  private listeners: Set<EventListener> = new Set()

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type: PipelineEventType, unitId?: string, step?: PipelineStep, data?: Record<string, unknown>): void {
    const event: PipelineEvent = { type, unitId, step, timestamp: Date.now(), data }
    logger.debug('Event', { type, unitId, step })
    this.listeners.forEach(listener => {
      try {
        listener(event)
      } catch (e) {
        logger.error('Event listener error', { error: e })
      }
    })
  }
}

// ============================================================================
// Pipeline Queue (Singleton)
// ============================================================================

class PipelineQueue {
  private store: IProgramStore | null = null
  private isProcessing = false
  private eventEmitter = new PipelineEventEmitter()
  private currentUnitId: string | null = null

  /**
   * Initialize with store
   */
  initialize(store: IProgramStore): void {
    if (this.store) {
      logger.warn('PipelineQueue already initialized')
      return
    }
    this.store = store
    logger.info('PipelineQueue initialized')

    // Check for incomplete tasks on startup (recovery)
    this.recoverIncompleteTasks()
  }

  /**
   * Subscribe to pipeline events (for UI)
   */
  subscribe(listener: EventListener): () => void {
    return this.eventEmitter.subscribe(listener)
  }

  /**
   * Add a unit to the queue for processing
   */
  async enqueue(unitId: string): Promise<void> {
    if (!this.store) throw new Error('PipelineQueue not initialized')

    // Create task in DB (for durability)
    await this.store.tasks.create({
      taskType: 'process_unit',
      payloadJson: JSON.stringify({ unitId }),
      priority: 'normal',
      maxAttempts: 3,
    })

    logger.info('Enqueued unit', { unitId })
    this.eventEmitter.emit('queue:item_added', unitId)

    // Try to process (will skip if already processing)
    this.processNext()
  }

  /**
   * Get current queue status
   */
  async getStatus(): Promise<{
    isProcessing: boolean
    currentUnitId: string | null
    pendingCount: number
    completedCount: number
    failedCount: number
  }> {
    if (!this.store) {
      return { isProcessing: false, currentUnitId: null, pendingCount: 0, completedCount: 0, failedCount: 0 }
    }

    const pending = await this.store.tasks.getPending()
    const completed = await this.store.tasks.getByStatus('completed')
    const failed = await this.store.tasks.getByStatus('failed')

    return {
      isProcessing: this.isProcessing,
      currentUnitId: this.currentUnitId,
      pendingCount: pending.length,
      completedCount: completed.length,
      failedCount: failed.length,
    }
  }

  /**
   * Process next item in queue (called internally)
   */
  private async processNext(): Promise<void> {
    if (!this.store) return
    if (this.isProcessing) return // Already processing one

    // Get next pending task
    const pending = await this.store.tasks.getPending()
    const task = pending[0]
    if (!task) {
      this.eventEmitter.emit('queue:idle')
      return
    }

    // Mark as processing
    this.isProcessing = true
    const payload = JSON.parse(task.payloadJson) as { unitId: string }
    this.currentUnitId = payload.unitId

    // Get unit text for event
    const unit = await this.store.conversations.getById(payload.unitId)
    const unitText = unit ? (unit.sanitizedText || unit.rawText).slice(0, 100) : ''

    await this.store.tasks.update(task.id, { status: 'processing', startedAt: now() })
    this.eventEmitter.emit('queue:processing_started', payload.unitId, undefined, {
      description: 'Starting pipeline processing',
      text: unitText,
    })

    try {
      // Run the pipeline
      await this.runPipeline(task, payload.unitId)

      // Mark complete
      await this.store.tasks.update(task.id, { status: 'completed', completedAt: now() })
      this.eventEmitter.emit('queue:item_completed', payload.unitId, undefined, {
        description: 'Pipeline processing complete',
        text: unitText,
      })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Pipeline failed', { unitId: payload.unitId, error: errorMsg })

      await this.store.tasks.update(task.id, {
        status: 'failed',
        lastError: errorMsg,
        lastErrorAt: now(),
      })
      this.eventEmitter.emit('queue:item_failed', payload.unitId, undefined, { error: errorMsg })
    } finally {
      this.isProcessing = false
      this.currentUnitId = null

      // Process next item
      this.processNext()
    }
  }

  /**
   * THE PIPELINE - All steps in sequence, clear and visible
   */
  private async runPipeline(task: Task, unitId: string): Promise<void> {
    if (!this.store) throw new Error('Store not initialized')

    // Get current step from checkpoint (for recovery)
    const checkpoint = task.checkpointJson ? JSON.parse(task.checkpointJson) : null
    const lastStep = (checkpoint?.step as PipelineStep) || 'pending'
    const stepIndex = STEP_ORDER.indexOf(lastStep)

    logger.info('Running pipeline', { unitId, lastStep, resuming: stepIndex > 0 })

    // Get unit
    const unit = await this.store.conversations.getById(unitId)
    if (!unit) throw new Error(`Unit not found: ${unitId}`)

    // Already fully processed? Skip.
    if (unit.processed) {
      logger.info('Unit already processed', { unitId })
      return
    }

    // ========== STEP 1: PREPROCESS ==========
    if (stepIndex < STEP_ORDER.indexOf('preprocess')) {
      this.eventEmitter.emit('queue:step_started', unitId, 'preprocess', {
        description: 'Finding patterns in text',
        text: (unit.sanitizedText || unit.rawText).slice(0, 100),
      })
      const preprocessResult = await this.stepPreprocess(unit)
      await this.saveCheckpoint(task.id, 'preprocess')
      this.eventEmitter.emit('queue:step_completed', unitId, 'preprocess', {
        description: 'Pattern matching complete',
        spansFound: preprocessResult.spansCreated,
      })
    }

    // ========== STEP 2: EXTRACT (LLM) ==========
    if (stepIndex < STEP_ORDER.indexOf('extract')) {
      this.eventEmitter.emit('queue:step_started', unitId, 'extract', {
        description: 'Calling LLM to extract primitives',
        text: (unit.sanitizedText || unit.rawText).slice(0, 100),
      })
      const extractResult = await this.stepExtract(unit)
      await this.saveCheckpoint(task.id, 'extract')
      this.eventEmitter.emit('queue:step_completed', unitId, 'extract', {
        description: extractResult.skipped ? 'Skipped (already extracted)' : 'LLM extraction complete',
        skipped: extractResult.skipped,
        propositions: extractResult.propositions,
        stances: extractResult.stances,
        relations: extractResult.relations,
        entityMentions: extractResult.entityMentions,
      })
    }

    // ========== STEP 3: RESOLVE ENTITIES ==========
    if (stepIndex < STEP_ORDER.indexOf('resolve')) {
      this.eventEmitter.emit('queue:step_started', unitId, 'resolve', {
        description: 'Resolving entity mentions to known entities',
      })
      const resolveResult = await this.stepResolve(unit)
      await this.saveCheckpoint(task.id, 'resolve')
      this.eventEmitter.emit('queue:step_completed', unitId, 'resolve', {
        description: 'Entity resolution complete',
        mentionsResolved: resolveResult.resolved,
        newEntities: resolveResult.newEntities,
      })
    }

    // ========== STEP 4: DERIVE CLAIMS ==========
    if (stepIndex < STEP_ORDER.indexOf('derive')) {
      this.eventEmitter.emit('queue:step_started', unitId, 'derive', {
        description: 'Deriving claims from propositions + stances',
      })
      const deriveResult = await this.stepDerive(unit)
      await this.saveCheckpoint(task.id, 'derive')
      this.eventEmitter.emit('queue:step_completed', unitId, 'derive', {
        description: 'Claim derivation complete',
        claimsCreated: deriveResult.claimsCreated,
      })
    }

    // ========== STEP 5: MARK COMPLETE ==========
    await this.store.conversations.markProcessed(unitId)
    await this.saveCheckpoint(task.id, 'complete')

    logger.info('Pipeline complete', { unitId })
  }

  // --------------------------------------------------------------------------
  // Pipeline Step Implementations
  // --------------------------------------------------------------------------

  private async stepPreprocess(unit: ConversationUnit): Promise<{ spansCreated: number }> {
    if (!this.store) return { spansCreated: 0 }

    const text = unit.sanitizedText || unit.rawText
    const allExtractors = extractorRegistry.getAll()
    const matchResults = findPatternMatches(text, allExtractors)

    let spansCreated = 0
    for (const result of matchResults) {
      for (const match of result.matches) {
        await this.store.spans.create({
          conversationId: unit.id,
          charStart: match.position.start,
          charEnd: match.position.end,
          textExcerpt: match.text,
          matchedBy: 'pattern',
          patternId: match.patternId,
          createdAt: now(),
        })
        spansCreated++
      }
    }

    logger.debug('Preprocess done', { unitId: unit.id, spansCreated })
    return { spansCreated }
  }

  private async stepExtract(unit: ConversationUnit): Promise<{
    skipped: boolean;
    propositions: number;
    stances: number;
    relations: number;
    entityMentions: number;
  }> {
    if (!this.store) return { skipped: true, propositions: 0, stances: 0, relations: 0, entityMentions: 0 }

    // Check if already extracted (idempotency)
    const existing = await this.store.propositions.getByConversation(unit.id)
    if (existing.length > 0) {
      logger.info('Already extracted, skipping LLM', { unitId: unit.id })
      return { skipped: true, propositions: existing.length, stances: 0, relations: 0, entityMentions: 0 }
    }

    // Get context
    const spans = await this.store.spans.getByConversation(unit.id)
    const knownEntities = await this.store.entities.getRecent(20)
    const recentPropositions = await this.store.propositions.getRecent(10)

    // Build input
    const input: PrimitiveExtractionInput = {
      utterance: {
        id: unit.id,
        rawText: unit.rawText,
        sessionId: unit.sessionId,
        timestamp: unit.timestamp,
        speaker: unit.speaker || 'user',
      },
      spans: spans.map(s => ({
        id: s.id,
        charStart: s.charStart,
        charEnd: s.charEnd,
        textExcerpt: s.textExcerpt,
        patternId: s.patternId,
      })),
      knownEntities: knownEntities.map(e => {
        let aliases: string[] = []
        try { aliases = JSON.parse(e.aliases || '[]') } catch { /* ignore */ }
        return { id: e.id, canonicalName: e.canonicalName, type: e.entityType, aliases }
      }),
      recentPropositions: recentPropositions.map(p => ({
        id: p.id,
        content: p.content,
        subject: p.subject,
      })),
      llmTier: 'small',
    }

    // Call LLM
    const startTime = Date.now()
    const result = await extractPrimitives(input)
    const processingTimeMs = Date.now() - startTime

    // Store propositions
    const propIdMap = new Map<string, string>()
    const propositionIds: string[] = []

    for (const propData of result.propositions) {
      const propSpanIds = propData.spanIds.filter(id => spans.some(s => s.id === id))
      const prop = await this.store.propositions.create({
        ...propData,
        spanIds: propSpanIds,
        conversationId: unit.id,
      })
      propositionIds.push(prop.id)
      if (propData.conversationId) {
        propIdMap.set(propData.conversationId, prop.id)
      }

      // Create extraction trace for proposition
      const firstSpan = spans.find(s => propSpanIds.includes(s.id))
      await this.store.extractionTraces.create({
        targetType: 'proposition',
        targetId: prop.id,
        conversationId: unit.id,
        inputText: unit.rawText,
        spanId: firstSpan?.id || null,
        charStart: firstSpan?.charStart ?? null,
        charEnd: firstSpan?.charEnd ?? null,
        matchedPattern: firstSpan?.patternId || null,
        matchedText: firstSpan?.textExcerpt || null,
        llmPrompt: result.metadata.llmPrompt,
        llmResponse: result.metadata.llmResponse,
        llmModel: result.metadata.model,
        llmTokensUsed: result.metadata.tokensUsed,
        processingTimeMs,
        extractorId: 'primitive-extractor',
      })
    }

    // Store stances
    for (let i = 0; i < result.stances.length; i++) {
      const stanceData = result.stances[i]
      const realPropId = propositionIds[i] || stanceData.propositionId
      await this.store.stances.create({ ...stanceData, propositionId: realPropId })
    }

    // Store relations
    for (const relData of result.relations) {
      const sourceId = propIdMap.get(relData.sourceId) || relData.sourceId
      const targetId = propIdMap.get(relData.targetId) || relData.targetId
      if (propositionIds.includes(sourceId) && propositionIds.includes(targetId)) {
        await this.store.relations.create({ ...relData, sourceId, targetId })
      }
    }

    // Store entity mentions for resolve step
    for (const m of result.entityMentions) {
      await this.store.entityMentions.create({
        conversationId: unit.id,
        text: m.text,
        mentionType: m.mentionType as CreateEntityMention['mentionType'],
        suggestedType: m.suggestedType as CreateEntityMention['suggestedType'],
        spanId: m.spanId,
        createdAt: now(),
      })
    }

    logger.debug('Extract done', { unitId: unit.id, propositions: propositionIds.length })
    return {
      skipped: false,
      propositions: result.propositions.length,
      stances: result.stances.length,
      relations: result.relations.length,
      entityMentions: result.entityMentions.length,
    }
  }

  private async stepResolve(unit: ConversationUnit): Promise<{ resolved: number; newEntities: number }> {
    if (!this.store) return { resolved: 0, newEntities: 0 }

    // Get unresolved mentions for this unit
    const mentions = await this.store.entityMentions.getByConversation(unit.id)
    const unresolved = mentions.filter(m => !m.resolvedEntityId)

    if (unresolved.length === 0) {
      logger.debug('No unresolved mentions', { unitId: unit.id })
      return { resolved: 0, newEntities: 0 }
    }

    // Count entities before resolution
    const entitiesBefore = (await this.store.entities.getAll()).length

    await resolveEntities({
      mentions: unresolved.map(m => ({
        conversationId: m.conversationId,
        text: m.text,
        mentionType: m.mentionType,
        suggestedType: m.suggestedType,
        spanId: m.spanId,
        createdAt: m.createdAt,
      })),
      store: this.store,
      sessionId: unit.sessionId,
    })

    // Count entities after resolution
    const entitiesAfter = (await this.store.entities.getAll()).length
    const newEntities = entitiesAfter - entitiesBefore

    logger.debug('Resolve done', { unitId: unit.id, resolved: unresolved.length, newEntities })
    return { resolved: unresolved.length, newEntities }
  }

  private async stepDerive(unit: ConversationUnit): Promise<{ claimsCreated: number }> {
    if (!this.store) return { claimsCreated: 0 }

    const propositions = await this.store.propositions.getByConversation(unit.id)
    let claimsCreated = 0

    for (const prop of propositions) {
      const stances = await this.store.stances.getByProposition(prop.id)
      if (stances.length === 0) continue

      const stance = stances[0]
      const claimData = deriveClaim(prop, stance)

      const claim = await this.store.claims.create(claimData)

      await this.store.claims.addSource({
        claimId: claim.id,
        unitId: unit.id,
      })

      // Create extraction trace for claim (copy from proposition trace)
      const propTraces = await this.store.extractionTraces.getByTargetId(prop.id)
      if (propTraces.length > 0) {
        const propTrace = propTraces[0]
        await this.store.extractionTraces.create({
          targetType: 'claim',
          targetId: claim.id,
          conversationId: unit.id,
          inputText: propTrace.inputText,
          spanId: propTrace.spanId,
          charStart: propTrace.charStart,
          charEnd: propTrace.charEnd,
          matchedPattern: propTrace.matchedPattern,
          matchedText: propTrace.matchedText,
          llmPrompt: propTrace.llmPrompt,
          llmResponse: propTrace.llmResponse,
          llmModel: propTrace.llmModel,
          llmTokensUsed: propTrace.llmTokensUsed,
          processingTimeMs: propTrace.processingTimeMs,
          extractorId: 'claim-deriver',
        })
      }

      claimsCreated++
    }

    logger.debug('Derive done', { unitId: unit.id, claimsCreated })
    return { claimsCreated }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async saveCheckpoint(taskId: string, step: PipelineStep): Promise<void> {
    if (!this.store) return
    await this.store.tasks.update(taskId, {
      checkpointJson: JSON.stringify({ step, timestamp: now() }),
    })
  }

  private async recoverIncompleteTasks(): Promise<void> {
    if (!this.store) return

    // Find tasks stuck in 'processing' (crashed mid-execution)
    const processing = await this.store.tasks.getByStatus('processing')
    for (const task of processing) {
      logger.info('Recovering stuck task', { taskId: task.id })
      await this.store.tasks.update(task.id, { status: 'pending' })
    }

    // Start processing
    this.processNext()
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let queueInstance: PipelineQueue | null = null

export function getPipelineQueue(): PipelineQueue {
  if (!queueInstance) {
    queueInstance = new PipelineQueue()
  }
  return queueInstance
}

export function resetPipelineQueue(): void {
  queueInstance = null
}
