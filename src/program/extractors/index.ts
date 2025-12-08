/**
 * Extractors Index
 *
 * Re-exports all extractor-related types and utilities.
 */

// Types
export type {
  PatternMatch,
  PatternType,
  PatternDef,
  LLMProvider,
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

// Base extractor
export { BaseExtractor, parseJSONResponse } from './baseExtractor';

// Extractor registry
export { extractorRegistry, registerExtractor } from './registry';

// Import all programs to register them
export * from './programs';
