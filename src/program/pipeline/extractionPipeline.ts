/**
 * Extraction Pipeline
 *
 * Orchestrates the extraction process:
 * 1. Pattern matching to determine which extractors to run
 * 2. Token budgeting to fit context
 * 3. LLM calls for extraction
 * 4. Result aggregation and deduplication
 */

import type { ConversationUnit, ClaimType } from '../types';
import type {
  ExtractionProgram,
  ExtractorContext,
  ExtractedClaim,
  ExtractedEntity,
  PatternMatch,
  TokenBudget,
} from '../extractors/types';
import type { ProgramStoreInstance } from '../store/programStore';
import { extractorRegistry } from '../extractors/registry';
import { findPatternMatches } from '../extractors/patternMatcher';
import { callLLM } from './llmClient';
import { createLogger } from '../utils/logger';
import { estimateTokens } from '../utils/tokens';

const logger = createLogger('Pipeline');

// ============================================================================
// Types
// ============================================================================

export interface PipelineInput {
  /** The conversation unit to process */
  unit: ConversationUnit;
  /** Summary of preceding context */
  precedingContext: string;
  /** Recent claims for context */
  recentClaims: Array<{
    statement: string;
    claim_type: ClaimType;
    subject: string;
  }>;
  /** Active thought chains (deprecated, kept for backward compatibility) */
  activeChains?: Array<{
    id: string;
    topic: string;
  }>;
  /** Known entities */
  knownEntities: Array<{
    canonical_name: string;
    entity_type: string;
  }>;
  /** Optional: specific extractors to run (otherwise runs all matching) */
  extractorIds?: string[];
  /** Store instance for checking active flags */
  store: ProgramStoreInstance;
}

export interface PipelineOutput {
  /** All extracted claims */
  claims: ExtractedClaim[];
  /** All extracted entities */
  entities: ExtractedEntity[];
  /** Which extractors ran */
  extractorsRun: string[];
  /** Total processing time */
  processingTimeMs: number;
  /** Total tokens used */
  tokensUsed: number;
}

// ============================================================================
// Pipeline Implementation
// ============================================================================

/**
 * Run the extraction pipeline on a conversation unit
 */
export async function runExtractionPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const startTime = Date.now();
  let totalTokens = 0;

  console.log('[Pipeline] Starting extraction for:', input.unit.sanitized_text.slice(0, 100));
  logger.info('Starting extraction pipeline', {
    unitId: input.unit.id,
    textLength: input.unit.sanitized_text.length,
  });

  // Step 1: Determine which extractors to run
  const extractorsToRun = selectExtractors(input);

  if (extractorsToRun.length === 0) {
    console.log('[Pipeline] No extractors matched!');
    logger.debug('No extractors matched for this unit');
    return {
      claims: [],
      entities: [],
      extractorsRun: [],
      processingTimeMs: Date.now() - startTime,
      tokensUsed: 0,
    };
  }

  console.log('[Pipeline] Running extractors:', extractorsToRun.map((e) => e.extractor.config.id));
  logger.debug('Selected extractors', {
    count: extractorsToRun.length,
    ids: extractorsToRun.map((e) => e.extractor.config.id),
  });

  // Step 2: Run extractors (can be parallelized with token budgeting)
  const allClaims: ExtractedClaim[] = [];
  const allEntities: ExtractedEntity[] = [];
  const extractorsRun: string[] = [];

  // Run extractors by tier priority - run small tier in parallel, others sequentially
  const smallTierExtractors = extractorsToRun.filter((e) => e.extractor.config.llm_tier === 'small');
  const otherTierExtractors = extractorsToRun.filter((e) => e.extractor.config.llm_tier !== 'small');

  // Run small tier extractors in parallel (fast and cheap)
  if (smallTierExtractors.length > 0) {
    const results = await Promise.all(
      smallTierExtractors.map((e) => runSingleExtractor(e.extractor, e.matches, input))
    );

    for (const result of results) {
      // Attach source tracking to each claim
      const claimsWithTracking = attachSourceTracking(result.claims, result.sourceInfo, result.extractorId);
      allClaims.push(...claimsWithTracking);
      allEntities.push(...result.entities);
      extractorsRun.push(result.extractorId);
      totalTokens += result.tokens;
    }
  }

  // Run medium/large tier extractors sequentially (potentially expensive/rate limited)
  for (const e of otherTierExtractors) {
    const result = await runSingleExtractor(e.extractor, e.matches, input);
    // Attach source tracking to each claim
    const claimsWithTracking = attachSourceTracking(result.claims, result.sourceInfo, result.extractorId);
    allClaims.push(...claimsWithTracking);
    allEntities.push(...result.entities);
    extractorsRun.push(result.extractorId);
    totalTokens += result.tokens;
  }

  // Step 3: Deduplicate and merge results
  const dedupedClaims = deduplicateClaims(allClaims);
  const dedupedEntities = deduplicateEntities(allEntities);

  logger.info('Extraction pipeline complete', {
    claimsExtracted: dedupedClaims.length,
    entitiesExtracted: dedupedEntities.length,
    extractorsRun: extractorsRun.length,
    processingTimeMs: Date.now() - startTime,
    tokensUsed: totalTokens,
  });

  return {
    claims: dedupedClaims,
    entities: dedupedEntities,
    extractorsRun,
    processingTimeMs: Date.now() - startTime,
    tokensUsed: totalTokens,
  };
}

/**
 * Select which extractors should run based on pattern matching
 */
function selectExtractors(input: PipelineInput): Array<{
  extractor: ExtractionProgram;
  matches: PatternMatch[];
}> {
  const allExtractors = extractorRegistry.getAllSortedByPriority();

  // Filter by active flag from database
  const activeExtractors = allExtractors.filter((e) => {
    const dbRecord = input.store.extractionPrograms.getById(e.config.id);
    // If no DB record, treat as active (shouldn't happen after sync)
    // If DB record exists, check active flag
    return !dbRecord || dbRecord.active;
  });

  // If specific extractors requested, filter to those
  let candidates = activeExtractors;
  if (input.extractorIds && input.extractorIds.length > 0) {
    const idSet = new Set(input.extractorIds);
    candidates = candidates.filter((e) => idSet.has(e.config.id));
  }

  // Split into always-run and pattern-based
  const alwaysRun = candidates.filter((e) => e.config.always_run);
  const patternBased = candidates.filter((e) => !e.config.always_run);

  const result: Array<{ extractor: ExtractionProgram; matches: PatternMatch[] }> = [];

  // Always-run extractors
  for (const extractor of alwaysRun) {
    result.push({ extractor, matches: [] });
  }

  // Pattern-based extractors
  if (patternBased.length > 0) {
    const matchResults = findPatternMatches(input.unit.sanitized_text, patternBased);

    for (const matchResult of matchResults) {
      const extractor = patternBased.find((e) => e.config.id === matchResult.extractor_id);
      if (extractor) {
        result.push({ extractor, matches: matchResult.matches });
      }
    }
  }

  return result;
}

/**
 * Run a single extractor
 */
async function runSingleExtractor(
  extractor: ExtractionProgram,
  matches: PatternMatch[],
  input: PipelineInput
): Promise<{
  extractorId: string;
  claims: ExtractedClaim[];
  entities: ExtractedEntity[];
  tokens: number;
  sourceInfo: {
    prompt: string;
    response: string;
    matches: PatternMatch[];
    unitId: string;
    unitText: string;
  };
}> {
  const config = extractor.config;

  try {
    // Build context
    const context: ExtractorContext = {
      unit: {
        id: input.unit.id,
        raw_text: input.unit.raw_text,
        sanitized_text: input.unit.sanitized_text,
        source: input.unit.source,
        preceding_context_summary: input.precedingContext,
      },
      matches,
      recent_claims: input.recentClaims,
      active_chains: input.activeChains || [],
      known_entities: input.knownEntities,
    };

    // Build prompt
    const prompt = extractor.buildPrompt(context);

    // Call LLM using tier abstraction
    const response = await callLLM({
      tier: config.llm_tier,
      prompt,
      options: config.llm_options,
    });

    // Parse response
    let result = extractor.parseResponse(response.content, context);

    // Post-process if available
    if (extractor.postProcess) {
      result.claims = extractor.postProcess(result.claims, context);
    }

    // Update metadata
    result.metadata.tokens_used = response.tokens_used.total;
    result.metadata.processing_time_ms = response.processing_time_ms;

    logger.debug('Extractor completed', {
      extractorId: config.id,
      claimsFound: result.claims.length,
      entitiesFound: result.entities.length,
    });

    return {
      extractorId: config.id,
      claims: result.claims,
      entities: result.entities,
      tokens: response.tokens_used.total,
      sourceInfo: {
        prompt,
        response: response.content,
        matches,
        unitId: input.unit.id,
        unitText: input.unit.sanitized_text,
      },
    };
  } catch (error) {
    logger.error('Extractor failed', {
      extractorId: config.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Return empty results on error
    return {
      extractorId: config.id,
      claims: [],
      entities: [],
      tokens: 0,
      sourceInfo: {
        prompt: '',
        response: '',
        matches: [],
        unitId: input.unit.id,
        unitText: input.unit.sanitized_text,
      },
    };
  }
}

/**
 * Attach source tracking metadata to extracted claims
 */
function attachSourceTracking(
  claims: ExtractedClaim[],
  sourceInfo: {
    prompt: string;
    response: string;
    matches: PatternMatch[];
    unitId: string;
    unitText: string;
  },
  _extractorId: string
): ExtractedClaim[] {
  return claims.map((claim) => ({
    ...claim,
    source_tracking: {
      unit_id: sourceInfo.unitId,
      unit_text: sourceInfo.unitText,
      text_excerpt: sourceInfo.unitText, // Full text for now, could be refined
      char_start: sourceInfo.matches[0]?.position?.start || null,
      char_end: sourceInfo.matches[0]?.position?.end || null,
      pattern_id: sourceInfo.matches[0]?.pattern_id || null,
      llm_prompt: sourceInfo.prompt,
      llm_response: sourceInfo.response,
    },
  }));
}

/**
 * Deduplicate claims by statement similarity
 */
function deduplicateClaims(claims: ExtractedClaim[]): ExtractedClaim[] {
  const seen = new Map<string, ExtractedClaim>();

  for (const claim of claims) {
    // Create a simplified key for deduplication
    const key = claim.statement.toLowerCase().trim();

    const existing = seen.get(key);
    if (!existing || claim.confidence > existing.confidence) {
      seen.set(key, claim);
    }
  }

  return Array.from(seen.values());
}

/**
 * Deduplicate entities by canonical name
 */
function deduplicateEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>();

  for (const entity of entities) {
    const key = entity.canonical_name.toLowerCase().trim();

    const existing = seen.get(key);
    if (existing) {
      // Merge aliases
      const allAliases = new Set([...existing.aliases, ...entity.aliases]);
      existing.aliases = Array.from(allAliases);
    } else {
      seen.set(key, { ...entity });
    }
  }

  return Array.from(seen.values());
}

/**
 * Build context with token budgeting
 */
export function buildBudgetedContext(
  input: PipelineInput,
  budget: TokenBudget
): {
  precedingContext: string;
  recentClaims: typeof input.recentClaims;
  activeChains: typeof input.activeChains;
  knownEntities: typeof input.knownEntities;
} {
  // Start with full context
  let precedingContext = input.precedingContext;
  let recentClaims = input.recentClaims;
  let activeChains = input.activeChains || [];
  let knownEntities = input.knownEntities;

  // Estimate base tokens
  const baseTokens = estimateTokens(input.unit.sanitized_text);

  // Budget remaining for context
  const remainingBudget = budget.context_tokens - baseTokens;

  if (remainingBudget <= 0) {
    // No room for context
    return {
      precedingContext: '',
      recentClaims: [],
      activeChains: [],
      knownEntities: [],
    };
  }

  // Allocate tokens proportionally
  const contextTokens = Math.min(estimateTokens(precedingContext), remainingBudget * 0.4);
  if (estimateTokens(precedingContext) > contextTokens) {
    // Truncate preceding context
    precedingContext = truncateToTokens(precedingContext, Math.floor(contextTokens));
  }

  // Limit claims
  const maxClaims = Math.min(budget.max_claims, recentClaims.length);
  recentClaims = recentClaims.slice(0, maxClaims);

  // Limit chains and entities
  activeChains = activeChains.slice(0, 5);
  knownEntities = knownEntities.slice(0, 10);

  return {
    precedingContext,
    recentClaims,
    activeChains,
    knownEntities,
  };
}

/**
 * Truncate text to approximately N tokens
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const words = text.split(/\s+/);
  const wordsPerToken = 0.75; // Rough estimate
  const maxWords = Math.floor(maxTokens * wordsPerToken);

  if (words.length <= maxWords) return text;

  return words.slice(0, maxWords).join(' ') + '...';
}
