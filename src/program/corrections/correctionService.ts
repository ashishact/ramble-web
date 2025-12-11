/**
 * Correction Service
 *
 * Orchestrates the correction system:
 * 1. Parses incoming text for correction statements
 * 2. Learns new corrections from parsed statements
 * 3. Applies stored corrections to text
 *
 * This service is designed to be called BEFORE the extraction pipeline
 * to modify sanitized_text with learned corrections.
 */

import type { ICorrectionStore } from '../interfaces/store';
import type { Correction, CreateCorrection } from '../types';
import { parseCorrections, mightContainCorrection, type CorrectionParseResult } from './correctionParser';
import { applyCorrections, type ApplyResult } from './correctionApplier';
import { createLogger } from '../utils/logger';

const logger = createLogger('CorrectionService');

export interface ProcessTextResult {
  // The corrected text (with learned corrections applied)
  correctedText: string;
  // Whether new corrections were learned
  learnedNewCorrections: boolean;
  // The corrections that were learned
  newCorrections: Correction[];
  // The corrections that were applied
  appliedCorrections: ApplyResult['appliedCorrections'];
  // Whether the input contained correction statements
  hadCorrectionStatements: boolean;
  // Text after removing correction statements (before applying stored corrections)
  textWithoutCorrectionStatements: string;
}

export interface CorrectionServiceConfig {
  // Minimum confidence threshold for learning corrections (0-1)
  minConfidence: number;
  // Whether to auto-learn corrections or just detect them
  autoLearn: boolean;
  // Whether to auto-apply corrections
  autoApply: boolean;
}

const DEFAULT_CONFIG: CorrectionServiceConfig = {
  minConfidence: 0.7,
  autoLearn: true,
  autoApply: true,
};

export class CorrectionService {
  private store: ICorrectionStore;
  private config: CorrectionServiceConfig;

  constructor(store: ICorrectionStore, config: Partial<CorrectionServiceConfig> = {}) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('CorrectionService initialized', { config: this.config });
  }

  /**
   * Process text: detect corrections, learn them, and apply stored corrections.
   * This is the main entry point for the correction pipeline.
   *
   * @param text The input text (typically sanitized_text from STT)
   * @param sourceUnitId Optional conversation unit ID where this text came from
   * @returns Processed result with corrected text and metadata
   */
  async processText(text: string, sourceUnitId?: string): Promise<ProcessTextResult> {
    // Quick check to avoid unnecessary processing
    const mightHaveCorrection = mightContainCorrection(text);

    // Step 1: Parse for correction statements
    let parseResult: CorrectionParseResult = {
      isCorrection: false,
      corrections: [],
      remainingText: text,
    };

    if (mightHaveCorrection) {
      parseResult = parseCorrections(text);
    }

    // Step 2: Learn new corrections if found and autoLearn is enabled
    const newCorrections: Correction[] = [];
    if (parseResult.isCorrection && this.config.autoLearn) {
      for (const parsed of parseResult.corrections) {
        if (parsed.confidence >= this.config.minConfidence) {
          const correction = await this.learnCorrection(
            parsed.wrongText,
            parsed.correctText,
            parsed.originalCase,
            sourceUnitId
          );
          if (correction) {
            newCorrections.push(correction);
          }
        }
      }
    }

    // Step 3: Apply stored corrections to the remaining text
    let applyResult: ApplyResult = {
      correctedText: parseResult.remainingText,
      appliedCorrections: [],
      correctionCount: 0,
    };

    if (this.config.autoApply) {
      applyResult = await applyCorrections(parseResult.remainingText, this.store);
    }

    logger.debug('Processed text', {
      hadCorrectionStatements: parseResult.isCorrection,
      learnedCount: newCorrections.length,
      appliedCount: applyResult.correctionCount,
    });

    return {
      correctedText: applyResult.correctedText,
      learnedNewCorrections: newCorrections.length > 0,
      newCorrections,
      appliedCorrections: applyResult.appliedCorrections,
      hadCorrectionStatements: parseResult.isCorrection,
      textWithoutCorrectionStatements: parseResult.remainingText,
    };
  }

  /**
   * Learn a new correction or update an existing one
   */
  async learnCorrection(
    wrongText: string,
    correctText: string,
    originalCase: string,
    sourceUnitId?: string
  ): Promise<Correction | null> {
    const normalizedWrong = wrongText.toLowerCase().trim();
    const normalizedCorrect = correctText.toLowerCase().trim();

    // Don't learn if they're the same
    if (normalizedWrong === normalizedCorrect) {
      logger.debug('Skipping correction - same text', { wrong: wrongText, correct: correctText });
      return null;
    }

    // Check if we already have this correction
    const existing = await this.store.getByWrongText(normalizedWrong);
    if (existing) {
      // Update if the correct text is different
      if (existing.correctText.toLowerCase() !== normalizedCorrect) {
        logger.info('Updating existing correction', {
          id: existing.id,
          oldCorrect: existing.correctText,
          newCorrect: correctText,
        });
        this.store.update(existing.id, {
          correctText: correctText,
          originalCase: originalCase,
        });
        return await this.store.getById(existing.id);
      }
      // Just increment usage if it's the same
      this.store.incrementUsageCount(existing.id);
      return existing;
    }

    // Create new correction
    const createData: CreateCorrection = {
      wrongText: normalizedWrong,
      correctText: correctText,
      originalCase: originalCase,
      sourceUnitId: sourceUnitId ?? null,
      usageCount: 0,
    };

    const correction = await this.store.create(createData);
    logger.info('Learned new correction', { id: correction.id, wrong: normalizedWrong, correct: correctText });
    return correction;
  }

  /**
   * Manually add a correction
   */
  async addCorrection(wrongText: string, correctText: string, sourceUnitId?: string): Promise<Correction | null> {
    return await this.learnCorrection(wrongText, correctText, correctText, sourceUnitId);
  }

  /**
   * Remove a correction
   */
  async removeCorrection(id: string): Promise<boolean> {
    const correction = await this.store.getById(id);
    if (correction) {
      logger.info('Removing correction', { id, wrong: correction.wrongText, correct: correction.correctText });
      return await this.store.delete(id);
    }
    return false;
  }

  /**
   * Get all corrections
   */
  async getAllCorrections(): Promise<Correction[]> {
    return await this.store.getAll();
  }

  /**
   * Get frequently used corrections
   */
  async getFrequentCorrections(limit = 10): Promise<Correction[]> {
    return await this.store.getFrequentlyUsed(limit);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CorrectionServiceConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Config updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): CorrectionServiceConfig {
    return { ...this.config };
  }
}

/**
 * Create a correction service instance
 */
export function createCorrectionService(
  store: ICorrectionStore,
  config?: Partial<CorrectionServiceConfig>
): CorrectionService {
  return new CorrectionService(store, config);
}
