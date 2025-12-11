/**
 * Extractor Types
 *
 * Core types for extraction programs. Extractors are TypeScript modules
 * that define how to find and extract claims from conversation units.
 */

import type { ClaimType, Temporality, Abstraction, SourceType, Stakes } from '../types';
import type { LLMTier } from '../types/llmTiers';

// ============================================================================
// Pattern Matching Types
// ============================================================================

/**
 * Pattern match - a segment of text that matched an extractor's patterns
 */
export interface PatternMatch {
  /** The matched text segment */
  text: string;
  /** Position in the original text */
  position: {
    start: number;
    end: number;
  };
  /** Surrounding context for better extraction */
  context: string;
  /** How relevant this match is (0-1) */
  relevanceScore: number;
  /** Which pattern triggered this match */
  patternId: string;
}

/**
 * Pattern types that extractors can use
 */
export type PatternType =
  | 'keyword' // Simple keyword matching
  | 'regex' // Regular expression
  | 'semantic' // Semantic similarity (requires embedding)
  | 'compound'; // Multiple patterns combined

/**
 * A single pattern definition
 */
export interface PatternDef {
  id: string;
  type: PatternType;
  /** For keyword/regex patterns */
  pattern?: string | RegExp;
  /** For semantic patterns - the concept to match */
  concept?: string;
  /** Weight for this pattern (default 1.0) */
  weight?: number;
  /** Whether pattern is case-sensitive */
  case_sensitive?: boolean;
}

// ============================================================================
// Extraction Program Types
// ============================================================================

/**
 * LLM provider for extraction (deprecated - use LLMTier instead)
 * @deprecated Use LLMTier from '../types/llmTiers' instead
 */
export type LLMProvider = 'groq' | 'gemini';

/**
 * Extraction result from LLM
 */
export interface ExtractionResult {
  /** Claims extracted from the text */
  claims: ExtractedClaim[];
  /** Entities mentioned */
  entities: ExtractedEntity[];
  /** Processing metadata */
  metadata: {
    model: string;
    tokensUsed: number;
    processingTimeMs: number;
  };
}

/**
 * A claim extracted by the LLM
 */
export interface ExtractedClaim {
  /** The claim statement */
  statement: string;
  /** Subject of the claim */
  subject: string;
  /** Claim type determined by extractor */
  claimType: ClaimType;
  /** Temporal nature */
  temporality: Temporality;
  /** Level of abstraction */
  abstraction: Abstraction;
  /** How claim was derived */
  sourceType: SourceType;
  /** Confidence in the extraction (0-1) */
  confidence: number;
  /** Emotional valence (-1 to 1) */
  emotionalValence: number;
  /** Emotional intensity (0 to 1) */
  emotionalIntensity: number;
  /** Importance level */
  stakes: Stakes;
  /** Optional: when claim becomes valid */
  valid_from?: number;
  /** Optional: when claim expires */
  valid_until?: number | null;
  /** Optional: elaborates on another claim */
  elaborates?: string | null;
  /** Source tracking for debugging (attached by pipeline) */
  source_tracking?: {
    unitId: string;
    unitText: string;
    textExcerpt: string;
    charStart: number | null;
    charEnd: number | null;
    patternId: string | null;
    llmPrompt: string | null;
    llmResponse: string | null;
  } | null;
}

/**
 * An entity extracted by the LLM
 */
export interface ExtractedEntity {
  /** Canonical name of the entity */
  canonicalName: string;
  /** Type of entity */
  entityType: 'person' | 'organization' | 'product' | 'place' | 'project' | 'role' | 'event' | 'concept';
  /** Alternative names mentioned */
  aliases: string[];
}

// ============================================================================
// Extraction Program Interface
// ============================================================================

/**
 * Configuration for an extraction program
 */
export interface ExtractorConfig {
  /** Unique identifier for this extractor */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this extractor finds */
  description: string;
  /** Primary claim types this extractor produces */
  claimTypes: ClaimType[];
  /** Patterns to match in text */
  patterns: PatternDef[];
  /** LLM tier to use (small/medium/large) - Settings determine actual provider */
  llmTier: LLMTier;
  /** Model-specific options */
  llm_options?: {
    temperature?: number;
    max_tokens?: number;
  };
  /** Minimum confidence to accept a claim */
  minConfidence: number;
  /** Priority (higher = run first) */
  priority: number;
  /** Whether to run on every unit or only matching ones */
  always_run?: boolean;
}

/**
 * Context provided to extraction programs
 */
export interface ExtractorContext {
  /** The conversation unit being processed */
  unit: {
    id: string;
    rawText: string;
    sanitizedText: string;
    source: 'speech' | 'text';
    precedingContextSummary: string;
  };
  /** Pattern matches found */
  matches: PatternMatch[];
  /** Recent claims for context */
  recentClaims: Array<{
    statement: string;
    claimType: ClaimType;
    subject: string;
  }>;
  /** Active thought chains */
  activeChains: Array<{
    id: string;
    topic: string;
  }>;
  /** Known entities */
  knownEntities: Array<{
    canonicalName: string;
    entityType: string;
  }>;
}

/**
 * The extraction program interface
 */
export interface ExtractionProgram {
  /** Configuration for this extractor */
  config: ExtractorConfig;

  /**
   * Build the prompt for the LLM
   * @param context - The extraction context
   * @returns The prompt to send to the LLM
   */
  buildPrompt(context: ExtractorContext): string;

  /**
   * Parse the LLM response into structured results
   * @param response - Raw LLM response
   * @param context - The extraction context
   * @returns Parsed extraction results
   */
  parseResponse(response: string, context: ExtractorContext): ExtractionResult;

  /**
   * Optional: Post-process claims before saving
   * @param claims - Extracted claims
   * @param context - The extraction context
   * @returns Processed claims
   */
  postProcess?(claims: ExtractedClaim[], context: ExtractorContext): ExtractedClaim[];
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Registry of all available extraction programs
 */
export interface ExtractorRegistry {
  /** Get an extractor by ID */
  get(id: string): ExtractionProgram | undefined;
  /** Get all extractors */
  getAll(): ExtractionProgram[];
  /** Get extractors by claim type */
  getByClaimType(type: ClaimType): ExtractionProgram[];
  /** Register an extractor */
  register(extractor: ExtractionProgram): void;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Result of pattern matching phase
 */
export interface PatternMatchResult {
  /** The extractor that matched */
  extractorId: string;
  /** All matches found */
  matches: PatternMatch[];
  /** Total relevance score */
  totalRelevance: number;
}

/**
 * Token budget for extraction
 */
export interface TokenBudget {
  /** Maximum tokens for context */
  contextTokens: number;
  /** Maximum tokens for response */
  responseTokens: number;
  /** Tokens per recent claim */
  claimTokens: number;
  /** Maximum recent claims to include */
  maxClaims: number;
}

/**
 * Default token budgets by LLM tier
 */
export const DEFAULT_TOKEN_BUDGETS: Record<LLMTier, TokenBudget> = {
  small: {
    contextTokens: 4000,
    responseTokens: 1000,
    claimTokens: 50,
    maxClaims: 10,
  },
  medium: {
    contextTokens: 8000,
    responseTokens: 2000,
    claimTokens: 50,
    maxClaims: 20,
  },
  large: {
    contextTokens: 16000,
    responseTokens: 4000,
    claimTokens: 100,
    maxClaims: 50,
  },
};
