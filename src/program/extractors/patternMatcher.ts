/**
 * Pattern Matcher
 *
 * Finds patterns in text to determine which extractors should run.
 * This is the first phase of the extraction pipeline.
 */

import type { PatternDef, PatternMatch, ExtractionProgram, PatternMatchResult } from './types';

// ============================================================================
// Pattern Matching Functions
// ============================================================================

/**
 * Match a keyword pattern (case-insensitive by default)
 */
function matchKeyword(text: string, pattern: PatternDef): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const keyword = pattern.pattern as string;
  const searchText = pattern.case_sensitive ? text : text.toLowerCase();
  const searchKeyword = pattern.case_sensitive ? keyword : keyword.toLowerCase();

  let pos = 0;
  while (true) {
    const index = searchText.indexOf(searchKeyword, pos);
    if (index === -1) break;

    // Extract context (50 chars before and after)
    const contextStart = Math.max(0, index - 50);
    const contextEnd = Math.min(text.length, index + keyword.length + 50);
    const context = text.slice(contextStart, contextEnd);

    matches.push({
      text: text.slice(index, index + keyword.length),
      position: { start: index, end: index + keyword.length },
      context,
      relevance_score: pattern.weight ?? 1.0,
      pattern_id: pattern.id,
    });

    pos = index + 1;
  }

  return matches;
}

/**
 * Match a regex pattern
 */
function matchRegex(text: string, pattern: PatternDef): PatternMatch[] {
  const matches: PatternMatch[] = [];

  let regex: RegExp;
  if (pattern.pattern instanceof RegExp) {
    // Clone with global flag
    regex = new RegExp(pattern.pattern.source, pattern.pattern.flags + (pattern.pattern.flags.includes('g') ? '' : 'g'));
  } else {
    const flags = pattern.case_sensitive ? 'g' : 'gi';
    regex = new RegExp(pattern.pattern as string, flags);
  }

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const index = match.index;
    const matchedText = match[0];

    // Extract context
    const contextStart = Math.max(0, index - 50);
    const contextEnd = Math.min(text.length, index + matchedText.length + 50);
    const context = text.slice(contextStart, contextEnd);

    matches.push({
      text: matchedText,
      position: { start: index, end: index + matchedText.length },
      context,
      relevance_score: pattern.weight ?? 1.0,
      pattern_id: pattern.id,
    });
  }

  return matches;
}

/**
 * Match a compound pattern (multiple patterns must match)
 * Note: Compound patterns are handled by the caller checking multiple patterns
 */
function matchCompound(_text: string, _pattern: PatternDef): PatternMatch[] {
  // Compound patterns require the caller to check multiple patterns together
  // The pattern definition would include sub-patterns that must all match
  // This is intentionally a no-op as the logic lives in the caller
  return [];
}

/**
 * Match a single pattern against text
 */
function matchPattern(text: string, pattern: PatternDef): PatternMatch[] {
  switch (pattern.type) {
    case 'keyword':
      return matchKeyword(text, pattern);
    case 'regex':
      return matchRegex(text, pattern);
    case 'compound':
      return matchCompound(text, pattern);
    case 'semantic':
      // Semantic matching requires embeddings, not implemented in pattern matcher
      // Will be handled by the LLM directly
      return [];
    default:
      return [];
  }
}

// ============================================================================
// Pattern Matcher Class
// ============================================================================

export interface PatternMatcherOptions {
  /** Minimum total relevance to consider a match */
  min_relevance?: number;
  /** Maximum matches per pattern */
  max_matches_per_pattern?: number;
}

const DEFAULT_OPTIONS: Required<PatternMatcherOptions> = {
  min_relevance: 0.3,
  max_matches_per_pattern: 10,
};

/**
 * Find all pattern matches in text for a set of extractors
 */
export function findPatternMatches(
  text: string,
  extractors: ExtractionProgram[],
  options?: PatternMatcherOptions
): PatternMatchResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: PatternMatchResult[] = [];

  for (const extractor of extractors) {
    // Skip if extractor always runs (no pattern matching needed)
    if (extractor.config.alwaysRun) {
      results.push({
        extractorId: extractor.config.id,
        matches: [],
        totalRelevance: 1.0, // Always relevant
      });
      continue;
    }

    const allMatches: PatternMatch[] = [];

    for (const pattern of extractor.config.patterns) {
      const matches = matchPattern(text, pattern);
      // Limit matches per pattern
      allMatches.push(...matches.slice(0, opts.max_matches_per_pattern));
    }

    if (allMatches.length === 0) continue;

    // Calculate total relevance (sum of unique match relevances)
    const uniqueMatches = deduplicateMatches(allMatches);
    const totalRelevance = uniqueMatches.reduce((sum, m) => sum + m.relevance_score, 0);

    if (totalRelevance >= opts.min_relevance) {
      results.push({
        extractorId: extractor.config.id,
        matches: uniqueMatches,
        totalRelevance: totalRelevance,
      });
    }
  }

  // Sort by total relevance (highest first)
  return results.sort((a, b) => b.total_relevance - a.total_relevance);
}

/**
 * Remove duplicate/overlapping matches, keeping higher relevance ones
 */
function deduplicateMatches(matches: PatternMatch[]): PatternMatch[] {
  if (matches.length === 0) return [];

  // Sort by start position
  const sorted = [...matches].sort((a, b) => a.position.start - b.position.start);
  const result: PatternMatch[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = result[result.length - 1];

    // Check for overlap
    if (current.position.start < previous.position.end) {
      // Overlapping - keep the one with higher relevance
      if (current.relevance_score > previous.relevance_score) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }

  return result;
}

/**
 * Get the most relevant text segments from matches
 */
export function getRelevantSegments(matches: PatternMatch[], maxSegments: number = 5): string[] {
  const sorted = [...matches].sort((a, b) => b.relevance_score - a.relevance_score);
  return sorted.slice(0, maxSegments).map((m) => m.context);
}

/**
 * Check if a specific extractor should run based on text content
 */
export function shouldExtractorRun(
  text: string,
  extractor: ExtractionProgram,
  options?: PatternMatcherOptions
): { should_run: boolean; matches: PatternMatch[]; relevance: number } {
  if (extractor.config.alwaysRun) {
    return { should_run: true, matches: [], relevance: 1.0 };
  }

  const results = findPatternMatches(text, [extractor], options);

  if (results.length === 0) {
    return { should_run: false, matches: [], relevance: 0 };
  }

  return {
    should_run: true,
    matches: results[0].matches,
    relevance: results[0].total_relevance,
  };
}

/**
 * Merge overlapping matches into larger segments
 */
export function mergeAdjacentMatches(matches: PatternMatch[], maxGap: number = 50): PatternMatch[] {
  if (matches.length === 0) return [];

  const sorted = [...matches].sort((a, b) => a.position.start - b.position.start);
  const merged: PatternMatch[] = [];

  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    // Check if matches are close enough to merge
    if (next.position.start - current.position.end <= maxGap) {
      // Extend current match
      current.position.end = Math.max(current.position.end, next.position.end);
      current.relevance_score = Math.max(current.relevance_score, next.relevance_score);
      // Extend context by appending the tail of the next context
      current.context = current.context + next.context.slice(Math.max(0, next.context.length - 50));
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}
