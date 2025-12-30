/**
 * Preprocess Unit Handler
 *
 * Task: preprocess_unit
 * Input: unit:created event
 * Output: unit:preprocessed event
 *
 * Steps:
 * 1. Apply corrections (for speech input)
 * 2. Compute spans via pattern matching
 * 3. Save spans to DB
 * 4. Emit unit:preprocessed event
 */

import type { TaskCheckpoint } from '../../types';
import type { Span } from '../../schemas/primitives';
import type { PipelineTaskHandler, TaskContext, PreprocessResult } from './types';
import type { UnitCreatedPayload } from '../events/types';
import { emitUnitPreprocessed } from '../events/eventBus';
import { findPatternMatches } from '../../extractors/patternMatcher';
import { extractorRegistry } from '../../extractors/registry';
import { createCorrectionService, type ProcessTextResult } from '../../corrections';
import { createLogger } from '../../utils/logger';

const logger = createLogger('PreprocessHandler');

/**
 * Preprocess unit handler implementation
 */
export class PreprocessUnitHandler implements PipelineTaskHandler<UnitCreatedPayload, PreprocessResult> {
  readonly taskType = 'preprocess_unit' as const;

  async execute(
    payload: UnitCreatedPayload,
    context: TaskContext,
    _checkpoint: TaskCheckpoint | null
  ): Promise<PreprocessResult> {
    const { store, eventBus } = context;
    const { unitId, sessionId, source } = payload;

    logger.info('Starting preprocess', { unitId, source });

    // Get the unit
    const unit = await store.conversations.getById(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    // Step 1: Apply corrections (for speech only)
    await context.checkpoint('corrections');
    let sanitizedText = unit.sanitizedText || unit.rawText;
    let correctionResult: { applied: number; learned: number } | undefined;

    if (source === 'speech') {
      const result = await this.applyCorrections(sanitizedText, store);
      if (result) {
        sanitizedText = result.correctedText;
        correctionResult = {
          applied: result.appliedCorrections.length,
          learned: result.newCorrections.length,
        };

        // Update unit with corrected text if changed
        if (result.correctedText !== unit.sanitizedText) {
          await store.conversations.update(unitId, {
            sanitizedText: result.correctedText,
          });
        }
      }
    }

    // Step 2: Compute spans via pattern matching
    await context.checkpoint('spans');
    const spans = await this.computeSpans(unit.id, sanitizedText, store);
    const spanIds = spans.map((s) => s.id);

    logger.info('Preprocess complete', {
      unitId,
      spans: spanIds.length,
      correctionsApplied: correctionResult?.applied ?? 0,
    });

    // Build result
    const result: PreprocessResult = {
      unitId,
      sessionId,
      sanitizedText,
      spanIds,
      correctionResult,
    };

    // CRITICAL: Save is complete, NOW emit event
    emitUnitPreprocessed(eventBus, {
      unitId,
      sessionId,
      sanitizedText,
      spanIds,
      correctionResult,
    });

    return result;
  }

  /**
   * Apply corrections using the correction service
   */
  private async applyCorrections(
    text: string,
    store: TaskContext['store']
  ): Promise<ProcessTextResult | null> {
    try {
      const correctionService = createCorrectionService(store.corrections, {
        autoLearn: true,
        autoApply: true,
        minConfidence: 0.7,
      });

      const result = await correctionService.processText(text);

      if (result.learnedNewCorrections) {
        logger.info('Learned new corrections', {
          count: result.newCorrections.length,
        });
      }

      if (result.appliedCorrections.length > 0) {
        logger.info('Applied corrections', {
          count: result.appliedCorrections.length,
        });
      }

      return result;
    } catch (error) {
      logger.warn('Correction processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Compute spans using pattern matching from existing extractors
   */
  private async computeSpans(
    conversationId: string,
    text: string,
    store: TaskContext['store']
  ): Promise<Span[]> {
    const allExtractors = extractorRegistry.getAll();
    const matchResults = findPatternMatches(text, allExtractors);

    const spans: Span[] = [];
    const now = Date.now();

    for (const result of matchResults) {
      for (const match of result.matches) {
        // Create span in database
        const span = await store.spans.create({
          conversationId,
          charStart: match.position.start,
          charEnd: match.position.end,
          textExcerpt: match.text,
          matchedBy: 'pattern',
          patternId: match.patternId,
          createdAt: now,
        });
        spans.push(span);
      }
    }

    return spans;
  }
}

/**
 * Create a new preprocess unit handler
 */
export function createPreprocessUnitHandler(): PreprocessUnitHandler {
  return new PreprocessUnitHandler();
}
