/**
 * Vocabulary Service
 *
 * High-level operations for vocabulary management including:
 * - Adding new vocabulary entries (with phonetic pre-computation)
 * - Manual canonical corrections
 * - Voting-based canonical suggestions
 * - Auto-sync between entities and vocabulary
 */

import type { IVocabularyStore, IEntityStore } from '../interfaces/store';
import type {
  Vocabulary,
  CreateVocabulary,
  VocabularyEntityType,
} from '../schemas/vocabulary';
import {
  getVariantVotes,
  parseVariantCounts,
  serializeContextHints,
  type VariantVote,
} from '../schemas/vocabulary';
import { doubleMetaphone } from '../corrections/doubleMetaphone';
import { createLogger } from '../utils/logger';

const logger = createLogger('Pipeline');

/**
 * Voting-based canonical suggestion result
 */
export interface CanonicalSuggestion {
  vocabId: string;
  currentCanonical: string;
  suggestedCanonical: string;
  confidence: number;  // 0-1 based on vote distribution
  votes: VariantVote[];
}

/**
 * Configuration for vocabulary service
 */
export interface VocabularyServiceConfig {
  /** Minimum vote ratio for suggesting canonical change (default: 2.0 = 2x more votes) */
  minVoteRatio: number;
  /** Minimum total votes before suggesting canonical change (default: 3) */
  minTotalVotes: number;
}

const DEFAULT_CONFIG: VocabularyServiceConfig = {
  minVoteRatio: 2.0,
  minTotalVotes: 3,
};

/**
 * Vocabulary Service
 */
export class VocabularyService {
  private vocabularyStore: IVocabularyStore;
  private entityStore: IEntityStore;
  private config: VocabularyServiceConfig;

  constructor(
    vocabularyStore: IVocabularyStore,
    entityStore: IEntityStore,
    config?: Partial<VocabularyServiceConfig>
  ) {
    this.vocabularyStore = vocabularyStore;
    this.entityStore = entityStore;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add new vocabulary entry with pre-computed phonetics
   */
  async addVocabulary(data: {
    correctSpelling: string;
    entityType: VocabularyEntityType;
    contextHints?: string[];
    sourceEntityId?: string;
  }): Promise<Vocabulary> {
    const phonetic = doubleMetaphone(data.correctSpelling);

    const createData: CreateVocabulary = {
      correctSpelling: data.correctSpelling,
      entityType: data.entityType,
      contextHints: serializeContextHints(data.contextHints || []),
      phoneticPrimary: phonetic.primary,
      phoneticSecondary: phonetic.secondary,
      sourceEntityId: data.sourceEntityId ?? null,
      usageCount: 0,
      variantCountsJson: '{}',
    };

    const vocab = await this.vocabularyStore.create(createData);

    logger.info('Vocabulary entry added', {
      id: vocab.id,
      spelling: data.correctSpelling,
      phonetic: phonetic.primary,
    });

    return vocab;
  }

  /**
   * Manually correct canonical spelling
   * Updates both vocabulary and linked entity
   */
  async correctCanonical(vocabId: string, newCanonical: string): Promise<Vocabulary | null> {
    const vocab = await this.vocabularyStore.getById(vocabId);
    if (!vocab) {
      logger.warn('Vocabulary not found for canonical correction', { vocabId });
      return null;
    }

    const oldCanonical = vocab.correctSpelling;
    const phonetic = doubleMetaphone(newCanonical);

    // Update vocabulary
    const updated = await this.vocabularyStore.update(vocabId, {
      correctSpelling: newCanonical,
      phoneticPrimary: phonetic.primary,
      phoneticSecondary: phonetic.secondary,
    });

    // Update linked entity if exists
    if (vocab.sourceEntityId) {
      const entity = await this.entityStore.getById(vocab.sourceEntityId);
      if (entity) {
        const aliases = JSON.parse(entity.aliases || '[]') as string[];
        // Add old canonical as alias
        if (!aliases.includes(oldCanonical) && oldCanonical.toLowerCase() !== newCanonical.toLowerCase()) {
          aliases.push(oldCanonical);
        }
        await this.entityStore.update(entity.id, {
          canonicalName: newCanonical,
          aliases: JSON.stringify(aliases),
        });
        logger.info('Entity canonical updated', {
          entityId: entity.id,
          oldCanonical,
          newCanonical,
        });
      }
    }

    logger.info('Vocabulary canonical corrected', {
      vocabId,
      oldCanonical,
      newCanonical,
    });

    return updated;
  }

  /**
   * Get voting-based canonical suggestions
   * Returns entries where variant votes suggest a different canonical spelling
   */
  async getCanonicalSuggestions(): Promise<CanonicalSuggestion[]> {
    const allVocab = await this.vocabularyStore.getAll();
    const suggestions: CanonicalSuggestion[] = [];

    for (const vocab of allVocab) {
      const suggestion = this.analyzeVotesForSuggestion(vocab);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    // Sort by confidence descending
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze votes for a single vocabulary entry
   */
  private analyzeVotesForSuggestion(vocab: Vocabulary): CanonicalSuggestion | null {
    const votes = getVariantVotes(vocab.variantCountsJson);

    if (votes.length === 0) {
      return null;
    }

    // Check if we have enough votes
    const totalVotes = votes.reduce((sum, v) => sum + v.count, 0);
    if (totalVotes < this.config.minTotalVotes) {
      return null;
    }

    // Find the most voted variant
    const [topVote, secondVote] = votes;

    // Check if top variant is different from current canonical
    if (topVote.variant.toLowerCase() === vocab.correctSpelling.toLowerCase()) {
      return null;
    }

    // Check if top variant has enough vote advantage
    const secondCount = secondVote?.count ?? 0;
    if (secondCount > 0 && topVote.count < secondCount * this.config.minVoteRatio) {
      return null;
    }

    // Calculate confidence based on vote distribution
    const confidence = Math.min(1.0, topVote.count / (totalVotes * 0.5));

    return {
      vocabId: vocab.id,
      currentCanonical: vocab.correctSpelling,
      suggestedCanonical: topVote.variant,
      confidence,
      votes,
    };
  }

  /**
   * Apply a canonical suggestion (accepts the voting result)
   */
  async applySuggestion(suggestion: CanonicalSuggestion): Promise<Vocabulary | null> {
    return this.correctCanonical(suggestion.vocabId, suggestion.suggestedCanonical);
  }

  /**
   * Sync vocabulary from existing entities
   * Creates vocabulary entries for entities that don't have them
   */
  async syncFromEntities(): Promise<number> {
    const entities = await this.entityStore.getAll();
    let created = 0;

    for (const entity of entities) {
      // Check if vocabulary already exists for this entity
      const existing = await this.vocabularyStore.getBySourceEntity(entity.id);
      if (existing) {
        continue;
      }

      // Check if vocabulary exists by spelling
      const bySpelling = await this.vocabularyStore.getByCorrectSpelling(entity.canonicalName);
      if (bySpelling) {
        // Link existing vocabulary to this entity
        await this.vocabularyStore.update(bySpelling.id, {
          sourceEntityId: entity.id,
        });
        continue;
      }

      // Create new vocabulary entry
      const phonetic = doubleMetaphone(entity.canonicalName);
      await this.vocabularyStore.create({
        correctSpelling: entity.canonicalName,
        entityType: entity.entityType as VocabularyEntityType,
        contextHints: '[]',
        phoneticPrimary: phonetic.primary,
        phoneticSecondary: phonetic.secondary,
        sourceEntityId: entity.id,
        usageCount: 0,
        variantCountsJson: '{}',
      });
      created++;
    }

    logger.info('Vocabulary sync from entities complete', { created });
    return created;
  }

  /**
   * Get vocabulary statistics
   */
  async getStats(): Promise<{
    totalEntries: number;
    entriesWithSuggestions: number;
    totalVariants: number;
    averageVariantsPerEntry: number;
  }> {
    const allVocab = await this.vocabularyStore.getAll();
    const suggestions = await this.getCanonicalSuggestions();

    let totalVariants = 0;
    for (const vocab of allVocab) {
      const counts = parseVariantCounts(vocab.variantCountsJson);
      totalVariants += Object.keys(counts).length;
    }

    return {
      totalEntries: allVocab.length,
      entriesWithSuggestions: suggestions.length,
      totalVariants,
      averageVariantsPerEntry: allVocab.length > 0 ? totalVariants / allVocab.length : 0,
    };
  }

  /**
   * Delete a vocabulary entry
   */
  async deleteVocabulary(id: string): Promise<boolean> {
    const vocab = await this.vocabularyStore.getById(id);
    if (!vocab) {
      return false;
    }

    const deleted = await this.vocabularyStore.delete(id);
    if (deleted) {
      logger.info('Vocabulary entry deleted', { id, spelling: vocab.correctSpelling });
    }
    return deleted;
  }

  /**
   * Update vocabulary context hints
   */
  async updateContextHints(id: string, hints: string[]): Promise<Vocabulary | null> {
    return this.vocabularyStore.update(id, {
      contextHints: serializeContextHints(hints),
    });
  }

  /**
   * Get all vocabulary entries
   */
  async getAll(): Promise<Vocabulary[]> {
    return this.vocabularyStore.getAll();
  }

  /**
   * Get vocabulary by ID
   */
  async getById(id: string): Promise<Vocabulary | null> {
    return this.vocabularyStore.getById(id);
  }

  /**
   * Get frequently used vocabulary
   */
  async getFrequentlyUsed(limit: number = 20): Promise<Vocabulary[]> {
    return this.vocabularyStore.getFrequentlyUsed(limit);
  }
}

/**
 * Create a vocabulary service instance
 */
export function createVocabularyService(
  vocabularyStore: IVocabularyStore,
  entityStore: IEntityStore,
  config?: Partial<VocabularyServiceConfig>
): VocabularyService {
  return new VocabularyService(vocabularyStore, entityStore, config);
}
