/**
 * Extractors Index
 *
 * Re-exports all extractor-related types and utilities.
 *
 * Note: The extraction system has been simplified:
 * - Patterns are consolidated in patterns.ts (used for span detection)
 * - All LLM extraction is handled by primitiveExtractor.ts (one call)
 * - The old individual extractor programs are no longer needed
 */

// Types
export type {
  PatternMatch,
  PatternType,
  PatternDef,
  ExtractionResult,
  ExtractedClaim,
  ExtractedEntity,
  ExtractorConfig,
  ExtractorContext,
  ExtractionProgram,
  ExtractorRegistry,
  PatternMatchResult,
  TokenBudget,
} from './types';

export { DEFAULT_TOKEN_BUDGETS } from './types';

// Pattern matching
export {
  findPatternMatches,
  getRelevantSegments,
  shouldExtractorRun,
  mergeAdjacentMatches,
} from './patternMatcher';

// Extractor registry (now loads patterns from patterns.ts automatically)
export { extractorRegistry, registerExtractor } from './registry';

// Consolidated patterns
export { ALL_PATTERN_CONFIGS, type PatternConfig } from './patterns';
