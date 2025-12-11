/**
 * Conversation Processor
 *
 * Handles text processing, sanitization, and conversation unit creation
 */

import type { IProgramStore } from '../interfaces/store'
import type { QueueRunner } from '../pipeline/queueRunner'
import type { CorrectionService, ProcessTextResult } from '../corrections'
import type { ConversationUnit, CreateConversationUnit, ConversationSource } from '../types'
import { createLogger } from '../utils/logger'
import { now } from '../utils/time'

const logger = createLogger('ConversationProcessor')

interface ExtractFromUnitPayload {
  unitId: string
  sessionId: string
}

export class ConversationProcessor {
  private store: IProgramStore
  private queueRunner: QueueRunner
  private correctionService: CorrectionService | null

  constructor(
    store: IProgramStore,
    queueRunner: QueueRunner,
    correctionService: CorrectionService | null
  ) {
    this.store = store
    this.queueRunner = queueRunner
    this.correctionService = correctionService
  }

  /**
   * Process a new conversation unit (text from voice or input)
   */
  async processText(
    rawText: string,
    source: ConversationSource,
    sessionId: string,
    _metadata?: Record<string, unknown>
  ): Promise<{ unit: ConversationUnit; taskId: string; correctionResult?: ProcessTextResult }> {
    logger.info('processText called', { textLength: rawText.length, source })

    // Basic sanitization first (trim, whitespace normalization)
    const basicSanitized = this.sanitizeText(rawText)

    // Only apply corrections to speech input (STT), not typed text
    let sanitizedText = basicSanitized
    let correctionResult: ProcessTextResult | undefined

    if (source === 'speech' && this.correctionService) {
      // Process through correction service (learns new corrections and applies stored ones)
      correctionResult = await this.correctionService.processText(basicSanitized)
      sanitizedText = correctionResult.correctedText

      if (correctionResult.learnedNewCorrections) {
        logger.info('Learned new corrections', {
          count: correctionResult.newCorrections.length,
          corrections: correctionResult.newCorrections.map(
            (c) => `${c.wrongText} → ${c.correctText}`
          ),
        })
      }

      if (correctionResult.appliedCorrections.length > 0) {
        logger.info('Applied corrections to text', {
          count: correctionResult.appliedCorrections.length,
          changes: correctionResult.appliedCorrections.map(
            (c) => `${c.originalWord} → ${c.replacedWith}`
          ),
        })
      }
    }

    // Build preceding context
    const precedingContext = await this.buildPrecedingContext(sessionId, '')

    // Create conversation unit
    const data: CreateConversationUnit = {
      sessionId: sessionId,
      timestamp: now(),
      rawText: rawText,
      sanitizedText: sanitizedText,
      source,
      precedingContextSummary: precedingContext,
      processed: false,
    }

    const unit = await this.store.conversations.create(data)

    // Queue extraction task
    const taskId = await this.queueRunner.enqueue({
      taskType: 'extract_from_unit',
      payloadJson: JSON.stringify({
        unitId: unit.id,
        sessionId: sessionId,
      } as ExtractFromUnitPayload),
      priority: 'critical',
      maxAttempts: 3,
    })

    logger.info('Queued extraction for unit', { unitId: unit.id, taskId })

    return { unit, taskId, correctionResult }
  }

  /**
   * Sanitize input text
   */
  private sanitizeText(text: string): string {
    return (
      text
        .trim()
        .replace(/\s+/g, ' ') // Normalize whitespace
        .slice(0, 10000)
    ) // Limit length
  }

  /**
   * Build summary of preceding context
   */
  private async buildPrecedingContext(sessionId: string, excludeUnitId: string): Promise<string> {
    const units = await this.store.conversations.getBySession(sessionId)
    const recent = units.filter((u) => u.id !== excludeUnitId && u.processed).slice(-5)

    if (recent.length === 0) return ''

    return recent.map((u) => u.sanitizedText).join(' ')
  }
}

export function createConversationProcessor(
  store: IProgramStore,
  queueRunner: QueueRunner,
  correctionService: CorrectionService | null
): ConversationProcessor {
  return new ConversationProcessor(store, queueRunner, correctionService)
}
