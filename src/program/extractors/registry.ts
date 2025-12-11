/**
 * Extractor Registry
 *
 * Central registry for all extraction programs.
 * Extractors register themselves here and can be looked up by ID or claim type.
 */

import type { ExtractionProgram, ExtractorRegistry } from './types';
import type { ClaimType } from '../types';

// ============================================================================
// Registry Implementation
// ============================================================================

class ExtractorRegistryImpl implements ExtractorRegistry {
  private extractors: Map<string, ExtractionProgram> = new Map();
  private byClaimType: Map<ClaimType, ExtractionProgram[]> = new Map();

  /**
   * Get an extractor by ID
   */
  get(id: string): ExtractionProgram | undefined {
    return this.extractors.get(id);
  }

  /**
   * Get all registered extractors
   */
  getAll(): ExtractionProgram[] {
    return Array.from(this.extractors.values());
  }

  /**
   * Get extractors by claim type they produce
   */
  getByClaimType(type: ClaimType): ExtractionProgram[] {
    return this.byClaimType.get(type) || [];
  }

  /**
   * Register a new extractor
   */
  register(extractor: ExtractionProgram): void {
    const { id, claim_types } = extractor.config;

    // Store by ID
    if (this.extractors.has(id)) {
      console.warn(`[ExtractorRegistry] Overwriting extractor: ${id}`);
    }
    this.extractors.set(id, extractor);

    // Index by claim type
    for (const claimType of claim_types) {
      if (!this.byClaimType.has(claimType)) {
        this.byClaimType.set(claimType, []);
      }
      this.byClaimType.get(claimType)!.push(extractor);
    }

    console.log(`[ExtractorRegistry] Registered extractor: ${id} (${claim_types.join(', ')})`);
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
 */
export function registerExtractor(extractor: ExtractionProgram): void {
  extractorRegistry.register(extractor);
}
