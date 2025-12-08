/**
 * Extractor Interface
 *
 * Abstract interface for extraction programs.
 */

import { z } from 'zod';
import type { ClaimType } from '../types';

/**
 * Pattern types for matching text
 */
export type PatternType = 'regex' | 'keyword' | 'fuzzy' | 'structural' | 'negation' | 'sequence';

/**
 * Pattern definition
 */
export interface Pattern {
  type: PatternType;
  value: string | string[];
  weight: number; // Contribution to relevance score (0-1)
  context_window?: number; // Characters around match to include
}

/**
 * Match result from pattern matching
 */
export interface Match {
  programId: string;
  text: string;
  position: { start: number; end: number };
  context: string;
  patterns_matched: string[];
  relevance_score: number;
}

/**
 * Allocated match (after token budget)
 */
export interface AllocatedMatch extends Match {
  allocated_tokens: number;
  included: boolean;
  truncated: boolean;
}

/**
 * Relevance scorer configuration
 */
export interface RelevanceScorer {
  type: 'weighted_sum' | 'custom';
  weights?: Record<string, number>;
  customFunction?: string; // For extension-defined scorers
}

/**
 * Extraction program type
 */
export type ProgramType = ClaimType | 'entity';

/**
 * Extraction program definition
 */
export interface IExtractionProgram {
  id: string;
  name: string;
  type: ProgramType;
  version: number;
  priority: number; // Lower = runs first, higher priority in token budget

  // Pattern matching
  patterns: Pattern[];

  // Relevance scoring
  relevanceScorer: RelevanceScorer;

  // LLM interaction
  systemPrompt: string;
  extractionPrompt: string;
  outputSchema: z.ZodSchema;

  // Token budget for this program's LLM call
  tokenBudget: number;

  // Metadata
  active: boolean;
  isCore: boolean;
  successRate: number;
  runCount: number;
}

/**
 * Extraction output (raw from LLM)
 */
export interface ExtractionOutput {
  success: boolean;
  outputs: unknown[];
  confidence: number;
  reasoning?: string;
  error?: string;
}

/**
 * Extraction result (processed)
 */
export interface ExtractionResult {
  programId: string;
  unitId: string;
  outputs: unknown[];
  matchCount: number;
  tokensUsed: number;
  duration: number;
}

/**
 * Context provided to extractors
 */
export interface ExtractionContext {
  sessionId: string;
  timestamp: number;
  precedingContextSummary: string;
  activeChains: Array<{ id: string; topic: string }>;
  activeGoals: Array<{ id: string; statement: string }>;
  recentEntities: Array<{ name: string; type: string }>;
}

/**
 * Extractor runner interface
 */
export interface IExtractorRunner {
  /**
   * Run all active extractors on a conversation unit
   */
  extractAll(unitId: string): Promise<ExtractionResult[]>;

  /**
   * Run a specific extractor
   */
  extract(programId: string, unitId: string, matches: AllocatedMatch[]): Promise<ExtractionResult>;

  /**
   * Get all registered extraction programs
   */
  getPrograms(): IExtractionProgram[];

  /**
   * Get a specific program
   */
  getProgram(id: string): IExtractionProgram | null;

  /**
   * Get active programs
   */
  getActivePrograms(): IExtractionProgram[];

  /**
   * Get programs by type
   */
  getProgramsByType(type: ProgramType): IExtractionProgram[];
}
