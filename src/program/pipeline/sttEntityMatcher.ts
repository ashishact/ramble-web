/**
 * STT Entity Matcher
 *
 * Matches STT-transcribed entity names against vocabulary using:
 * 1. Exact match (fastest, highest confidence)
 * 2. Phonetic match (Double Metaphone)
 * 3. Edit distance match (Levenshtein)
 * 4. Context disambiguation (only when multiple matches)
 */

import type { IVocabularyStore } from '../interfaces/store';
import type { Vocabulary, VocabularyEntityType } from '../schemas/vocabulary';
import { doubleMetaphone } from '../corrections/doubleMetaphone';
import { isWithinEditThreshold } from '../corrections/levenshtein';
import { scoreWithContext, extractContext, type ContextMatch } from '../corrections/contextMatcher';
import { createLogger } from '../utils/logger';

const logger = createLogger('Pipeline');

/**
 * Result of STT entity matching
 */
export interface STTMatchResult {
  matched: boolean;
  vocabularyEntry: Vocabulary | null;
  matchType: 'exact' | 'phonetic' | 'fuzzy' | 'context' | 'none';
  confidence: number;  // 0-1
  sttVariant: string;  // The original STT text
  allMatches?: ContextMatch[];  // All potential matches (for debugging)
}

/**
 * Configuration for STT matching
 */
export interface STTMatcherConfig {
  /** Minimum confidence to consider a match (0-1) */
  minConfidence: number;
  /** Whether to include all matches in result (for debugging) */
  includeAllMatches: boolean;
}

const DEFAULT_CONFIG: STTMatcherConfig = {
  minConfidence: 0.5,
  includeAllMatches: false,
};

/**
 * STT Entity Matcher Service
 *
 * Matches STT-transcribed text against stored vocabulary
 * to find the correct canonical spelling.
 */
export class STTEntityMatcher {
  private store: IVocabularyStore;
  private config: STTMatcherConfig;

  constructor(store: IVocabularyStore, config?: Partial<STTMatcherConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Match an STT-transcribed text against vocabulary
   *
   * @param sttText - The text from speech-to-text
   * @param entityType - Optional entity type filter
   * @param contextWords - Context words for disambiguation
   * @param fullText - Optional full text for context extraction
   */
  async match(
    sttText: string,
    entityType: VocabularyEntityType | null = null,
    contextWords: string[] = [],
    fullText?: string
  ): Promise<STTMatchResult> {
    const sttLower = sttText.toLowerCase().trim();

    if (!sttLower) {
      return {
        matched: false,
        vocabularyEntry: null,
        matchType: 'none',
        confidence: 0,
        sttVariant: sttText,
      };
    }

    // Extract context from full text if provided and no context given
    if (fullText && contextWords.length === 0) {
      contextWords = extractContext(fullText, sttText);
    }

    // 1. Try exact match first (case-insensitive)
    const exactMatch = await this.store.getByCorrectSpelling(sttText);
    if (exactMatch && (!entityType || exactMatch.entityType === entityType)) {
      logger.debug('Exact match found', { sttText, match: exactMatch.correctSpelling });
      return {
        matched: true,
        vocabularyEntry: exactMatch,
        matchType: 'exact',
        confidence: 1.0,
        sttVariant: sttText,
      };
    }

    // 2. Get phonetic code and search for matches
    const sttPhonetic = doubleMetaphone(sttText);
    const phoneticMatches = await this.store.getByPhoneticCode(sttPhonetic.primary);

    // Also check secondary code
    let secondaryMatches: Vocabulary[] = [];
    if (sttPhonetic.secondary) {
      secondaryMatches = await this.store.getByPhoneticCode(sttPhonetic.secondary);
    }

    // 3. Get all vocabulary for fuzzy matching
    const allVocab = await this.store.getAll();

    // Filter by entity type if specified
    const filteredVocab = entityType
      ? allVocab.filter(v => v.entityType === entityType)
      : allVocab;

    // Find fuzzy matches using edit distance
    const fuzzyMatches = filteredVocab.filter(v =>
      isWithinEditThreshold(sttText, v.correctSpelling)
    );

    // 4. Combine and deduplicate candidates
    const candidateSet = new Set<string>();
    const candidates: Vocabulary[] = [];

    for (const v of [...phoneticMatches, ...secondaryMatches, ...fuzzyMatches]) {
      if (!candidateSet.has(v.id) && (!entityType || v.entityType === entityType)) {
        candidateSet.add(v.id);
        candidates.push(v);
      }
    }

    // No candidates found
    if (candidates.length === 0) {
      logger.debug('No matches found', { sttText });
      return {
        matched: false,
        vocabularyEntry: null,
        matchType: 'none',
        confidence: 0,
        sttVariant: sttText,
      };
    }

    // Single candidate - return it
    if (candidates.length === 1) {
      const match = candidates[0];
      const isPhonetic = phoneticMatches.includes(match) || secondaryMatches.includes(match);
      const confidence = isPhonetic ? 0.85 : 0.7;

      logger.debug('Single match found', {
        sttText,
        match: match.correctSpelling,
        type: isPhonetic ? 'phonetic' : 'fuzzy',
      });

      return {
        matched: confidence >= this.config.minConfidence,
        vocabularyEntry: match,
        matchType: isPhonetic ? 'phonetic' : 'fuzzy',
        confidence,
        sttVariant: sttText,
      };
    }

    // Multiple candidates - use context for disambiguation
    const scoredMatches = scoreWithContext(sttText, contextWords, candidates);

    if (scoredMatches.length === 0) {
      return {
        matched: false,
        vocabularyEntry: null,
        matchType: 'none',
        confidence: 0,
        sttVariant: sttText,
      };
    }

    const best = scoredMatches[0];

    logger.debug('Context disambiguation', {
      sttText,
      match: best.vocabularyEntry.correctSpelling,
      score: best.combinedScore,
      candidateCount: candidates.length,
    });

    const result: STTMatchResult = {
      matched: best.combinedScore >= this.config.minConfidence,
      vocabularyEntry: best.vocabularyEntry,
      matchType: best.matchType,
      confidence: best.combinedScore,
      sttVariant: sttText,
    };

    if (this.config.includeAllMatches) {
      result.allMatches = scoredMatches;
    }

    return result;
  }

  /**
   * Batch match multiple STT texts
   */
  async matchBatch(
    items: Array<{
      sttText: string;
      entityType?: VocabularyEntityType | null;
      fullText?: string;
    }>
  ): Promise<STTMatchResult[]> {
    const results: STTMatchResult[] = [];

    for (const item of items) {
      const result = await this.match(
        item.sttText,
        item.entityType ?? null,
        [],
        item.fullText
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Check if a word looks like it could be an entity name
   * (not a common word, starts with capital, etc.)
   */
  isLikelyEntityName(word: string): boolean {
    // Skip short words
    if (word.length < 2) return false;

    // Skip common words
    const commonWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'can', 'need',
    ]);
    if (commonWords.has(word.toLowerCase())) return false;

    // Check if starts with capital (proper noun hint)
    if (/^[A-Z]/.test(word)) return true;

    // Check for CamelCase or unusual casing (potential STT error)
    if (/[a-z][A-Z]/.test(word)) return true;

    return false;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<STTMatcherConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create an STT Entity Matcher instance
 */
export function createSTTEntityMatcher(
  store: IVocabularyStore,
  config?: Partial<STTMatcherConfig>
): STTEntityMatcher {
  return new STTEntityMatcher(store, config);
}
