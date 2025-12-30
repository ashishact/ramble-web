/**
 * Conversation Processor
 *
 * Creates conversation units and enqueues them for processing.
 * The queue handles all pipeline steps.
 */

import type { IProgramStore } from '../interfaces/store'
import type { CorrectionService, ProcessTextResult } from '../corrections'
import type { ConversationUnit, CreateConversationUnit, ConversationSource } from '../types'
import { getPipelineQueue } from '../pipeline/pipelineQueue'
import { createLogger } from '../utils/logger'
import { now } from '../utils/time'

const logger = createLogger('ConversationProcessor')

export class ConversationProcessor {
  private store: IProgramStore
  private correctionService: CorrectionService | null

  constructor(
    store: IProgramStore,
    correctionService: CorrectionService | null
  ) {
    this.store = store
    this.correctionService = correctionService
  }

  /**
   * Process a new conversation unit (text from voice or input)
   * Creates the unit and adds it to the queue.
   */
  async processText(
    rawText: string,
    source: ConversationSource,
    sessionId: string,
    _metadata?: Record<string, unknown>
  ): Promise<{ unit: ConversationUnit; correctionResult?: ProcessTextResult }> {
    logger.info('processText called', { textLength: rawText.length, source })

    // Basic sanitization first
    const basicSanitized = this.sanitizeText(rawText)

    // Apply corrections to speech input only
    let sanitizedText = basicSanitized
    let correctionResult: ProcessTextResult | undefined

    if (source === 'speech' && this.correctionService) {
      correctionResult = await this.correctionService.processText(basicSanitized)
      sanitizedText = correctionResult.correctedText

      if (correctionResult.learnedNewCorrections) {
        logger.info('Learned new corrections', { count: correctionResult.newCorrections.length })
      }
      if (correctionResult.appliedCorrections.length > 0) {
        logger.info('Applied corrections', { count: correctionResult.appliedCorrections.length })
      }
    }

    // Build preceding context
    const precedingContext = await this.buildPrecedingContext(sessionId, '')

    // Infer discourse function
    const discourseFunction = this.inferDiscourseFunction(sanitizedText)

    // Create conversation unit
    const data: CreateConversationUnit = {
      sessionId,
      timestamp: now(),
      rawText,
      sanitizedText,
      source,
      speaker: 'user',
      discourseFunction,
      precedingContextSummary: precedingContext,
      processed: false,
    }

    const unit = await this.store.conversations.create(data)
    logger.info('Created conversation unit', { unitId: unit.id })

    // Add to queue - pipeline will process it
    await getPipelineQueue().enqueue(unit.id)

    return { unit, correctionResult }
  }

  private sanitizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ').slice(0, 10000)
  }

  private inferDiscourseFunction(text: string): 'assert' | 'question' | 'command' | 'express' | 'commit' {
    const trimmed = text.trim().toLowerCase()

    if (trimmed.endsWith('?') || /^(what|who|where|when|why|how|is|are|do|does|can|will|should)\b/.test(trimmed)) {
      return 'question'
    }
    if (/^(please|could you|can you|would you|help me|show me|tell me|give me)\b/.test(trimmed)) {
      return 'command'
    }
    if (/\b(i will|i'll|i promise|i'm going to|i am going to|i commit)\b/.test(trimmed)) {
      return 'commit'
    }
    if (/\b(i feel|i'm feeling|i am feeling|i'm so|i am so|i love|i hate|i'm happy|i'm sad|i'm angry)\b/.test(trimmed)) {
      return 'express'
    }
    return 'assert'
  }

  private async buildPrecedingContext(sessionId: string, excludeUnitId: string): Promise<string> {
    const units = await this.store.conversations.getBySession(sessionId)
    const recent = units.filter(u => u.id !== excludeUnitId && u.processed).slice(-5)
    if (recent.length === 0) return ''
    return recent.map(u => u.sanitizedText).join(' ')
  }
}

export function createConversationProcessor(
  store: IProgramStore,
  correctionService: CorrectionService | null
): ConversationProcessor {
  return new ConversationProcessor(store, correctionService)
}
