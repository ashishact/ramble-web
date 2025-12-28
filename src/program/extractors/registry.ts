/**
 * Extractor Registry
 *
 * Central registry for all pattern configurations.
 * These are used by patternMatcher.ts for span detection.
 *
 * Note: The old extraction programs are now consolidated into patterns.ts.
 * The actual LLM extraction is handled by primitiveExtractor.ts (one call for all).
 */

import type { ExtractionProgram, ExtractorRegistry, ExtractionResult } from './types';
import type { ClaimType } from '../types';
import { ALL_PATTERN_CONFIGS, type PatternConfig } from './patterns';

// ============================================================================
// Pattern-to-Extractor Adapter
// ============================================================================

/**
 * Creates an ExtractionProgram from a PatternConfig.
 * The buildPrompt and parseResponse are stubs - all LLM extraction is now
 * handled by primitiveExtractor.ts.
 */
function patternConfigToExtractor(config: PatternConfig): ExtractionProgram {
  return {
    config: {
      id: config.id,
      name: config.name,
      description: config.description,
      claimTypes: config.claimTypes,
      patterns: config.patterns,
      llmTier: config.llmTier,
      llmOptions: {},
      minConfidence: config.minConfidence,
      priority: config.priority,
      alwaysRun: config.alwaysRun,
    },
    // Stub methods - never called, LLM extraction is now unified
    buildPrompt: () => '',
    parseResponse: (): ExtractionResult => ({
      claims: [],
      entities: [],
      metadata: { model: '', tokensUsed: 0, processingTimeMs: 0 },
    }),
  };
}

// ============================================================================
// Registry Implementation
// ============================================================================

class ExtractorRegistryImpl implements ExtractorRegistry {
  private extractors: Map<string, ExtractionProgram> = new Map();
  private byClaimType: Map<ClaimType, ExtractionProgram[]> = new Map();
  private initialized = false;

  /**
   * Initialize registry with consolidated patterns
   */
  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    for (const patternConfig of ALL_PATTERN_CONFIGS) {
      const extractor = patternConfigToExtractor(patternConfig);
      this.registerInternal(extractor);
    }
  }

  /**
   * Get an extractor by ID
   */
  get(id: string): ExtractionProgram | undefined {
    this.ensureInitialized();
    return this.extractors.get(id);
  }

  /**
   * Get all registered extractors
   */
  getAll(): ExtractionProgram[] {
    this.ensureInitialized();
    return Array.from(this.extractors.values());
  }

  /**
   * Get extractors by claim type they produce
   */
  getByClaimType(type: ClaimType): ExtractionProgram[] {
    this.ensureInitialized();
    return this.byClaimType.get(type) || [];
  }

  /**
   * Internal registration (used during initialization)
   */
  private registerInternal(extractor: ExtractionProgram): void {
    const { id, claimTypes } = extractor.config;

    this.extractors.set(id, extractor);

    for (const claimType of claimTypes) {
      if (!this.byClaimType.has(claimType)) {
        this.byClaimType.set(claimType, []);
      }
      this.byClaimType.get(claimType)!.push(extractor);
    }
  }

  /**
   * Register a new extractor (for external/dynamic registration)
   * @deprecated Patterns are now consolidated in patterns.ts
   */
  register(extractor: ExtractionProgram): void {
    this.ensureInitialized();
    const { id, claimTypes } = extractor.config;

    if (this.extractors.has(id)) {
      console.warn(`[ExtractorRegistry] Overwriting extractor: ${id}`);
    }
    this.extractors.set(id, extractor);

    for (const claimType of claimTypes) {
      if (!this.byClaimType.has(claimType)) {
        this.byClaimType.set(claimType, []);
      }
      this.byClaimType.get(claimType)!.push(extractor);
    }
  }

  /**
   * Get extractors sorted by priority (highest first)
   */
  getAllSortedByPriority(): ExtractionProgram[] {
    return this.getAll().sort((a, b) => b.config.priority - a.config.priority);
  }

  /**
   * Get extractors that should always run
   */
  getAlwaysRun(): ExtractionProgram[] {
    return this.getAll().filter((e) => e.config.alwaysRun);
  }

  /**
   * Get extractors that require pattern matching
   */
  getPatternBased(): ExtractionProgram[] {
    return this.getAll().filter((e) => !e.config.alwaysRun);
  }
}

// Singleton instance
export const extractorRegistry = new ExtractorRegistryImpl();

/**
 * Helper function to register an extractor
 * @deprecated Patterns are now consolidated in patterns.ts
 */
export function registerExtractor(extractor: ExtractionProgram): void {
  extractorRegistry.register(extractor);
}
