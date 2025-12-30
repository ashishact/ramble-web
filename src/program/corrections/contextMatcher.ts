/**
 * Context Matcher
 *
 * Uses surrounding context (words before/after) for disambiguation
 * when multiple phonetic/fuzzy matches exist.
 */

import type { Vocabulary } from '../schemas/vocabulary';
import { parseContextHints } from '../schemas/vocabulary';
import { doubleMetaphone, phoneticSimilarity, type DoubleMetaphoneResult } from './doubleMetaphone';
import { stringSimilarity } from './levenshtein';

/**
 * Scored match result with context analysis
 */
export interface ContextMatch {
  vocabularyEntry: Vocabulary;
  phoneticScore: number;    // 0-1: phonetic similarity
  editScore: number;        // 0-1: edit distance similarity
  contextScore: number;     // 0-1: context word overlap
  combinedScore: number;    // Weighted combination
  matchType: 'exact' | 'phonetic' | 'fuzzy' | 'context';
}

/**
 * Default weights for combining scores
 * Phonetic gets highest weight since STT errors are mostly phonetic
 */
const DEFAULT_WEIGHTS = {
  phonetic: 0.5,
  edit: 0.3,
  context: 0.2,
};

/**
 * Common English stop words to filter from context
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
  'they', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once', 'if',
]);

/**
 * Extract context words from surrounding text
 * Returns 1 word before and 1 word after the target word
 */
export function extractContext(fullText: string, targetWord: string): string[] {
  const words = fullText.toLowerCase().split(/\s+/);
  const targetLower = targetWord.toLowerCase();

  // Find the target word position
  const targetIndex = words.findIndex(w =>
    w.includes(targetLower) || targetLower.includes(w) || w === targetLower
  );

  if (targetIndex === -1) {
    // Target not found in text, return empty
    return [];
  }

  const contextWords: string[] = [];

  // Get word before (if exists and not stop word)
  if (targetIndex > 0) {
    const beforeWord = words[targetIndex - 1].replace(/[^a-z]/g, '');
    if (beforeWord.length > 1 && !STOP_WORDS.has(beforeWord)) {
      contextWords.push(beforeWord);
    }
  }

  // Get word after (if exists and not stop word)
  if (targetIndex < words.length - 1) {
    const afterWord = words[targetIndex + 1].replace(/[^a-z]/g, '');
    if (afterWord.length > 1 && !STOP_WORDS.has(afterWord)) {
      contextWords.push(afterWord);
    }
  }

  return contextWords;
}

/**
 * Calculate context overlap score between context words and vocabulary hints
 */
export function calculateContextScore(
  contextWords: string[],
  vocabularyHints: string[]
): number {
  if (contextWords.length === 0 || vocabularyHints.length === 0) {
    return 0;
  }

  const contextSet = new Set(contextWords.map(w => w.toLowerCase()));
  const hintsSet = new Set(vocabularyHints.map(w => w.toLowerCase()));

  let matchCount = 0;
  for (const contextWord of contextSet) {
    // Exact match or fuzzy match for context words
    for (const hint of hintsSet) {
      if (contextWord === hint || stringSimilarity(contextWord, hint) > 0.8) {
        matchCount++;
        break;
      }
    }
  }

  // Return ratio of matched context words
  return matchCount / Math.max(contextSet.size, 1);
}

/**
 * Score candidates against an STT word with context
 * Returns matches sorted by combined score (descending)
 */
export function scoreWithContext(
  sttText: string,
  contextWords: string[],
  candidates: Vocabulary[],
  weights: typeof DEFAULT_WEIGHTS = DEFAULT_WEIGHTS
): ContextMatch[] {
  if (candidates.length === 0) {
    return [];
  }

  const sttPhonetic = doubleMetaphone(sttText);
  const sttLower = sttText.toLowerCase().trim();

  const matches: ContextMatch[] = [];

  for (const candidate of candidates) {
    const candidateLower = candidate.correctSpelling.toLowerCase().trim();

    // Check for exact match first
    if (sttLower === candidateLower) {
      matches.push({
        vocabularyEntry: candidate,
        phoneticScore: 1.0,
        editScore: 1.0,
        contextScore: 1.0,
        combinedScore: 1.0,
        matchType: 'exact',
      });
      continue;
    }

    // Calculate phonetic score
    const candidatePhonetic: DoubleMetaphoneResult = {
      primary: candidate.phoneticPrimary,
      secondary: candidate.phoneticSecondary,
    };
    const phoneticScore = phoneticSimilarity(sttPhonetic, candidatePhonetic);

    // Calculate edit distance score
    const editScore = stringSimilarity(sttLower, candidateLower);

    // Calculate context score
    const hints = parseContextHints(candidate.contextHints);
    const contextScore = calculateContextScore(contextWords, hints);

    // Calculate combined score
    const combinedScore =
      weights.phonetic * phoneticScore +
      weights.edit * editScore +
      weights.context * contextScore;

    // Determine match type based on which score contributed most
    let matchType: ContextMatch['matchType'] = 'fuzzy';
    if (phoneticScore >= 0.8) {
      matchType = 'phonetic';
    } else if (contextScore >= 0.5 && candidates.length > 1) {
      matchType = 'context';
    }

    matches.push({
      vocabularyEntry: candidate,
      phoneticScore,
      editScore,
      contextScore,
      combinedScore,
      matchType,
    });
  }

  // Sort by combined score descending
  return matches.sort((a, b) => b.combinedScore - a.combinedScore);
}

/**
 * Quick check if a word might match any vocabulary entry
 * Uses phonetic codes for fast filtering
 */
export function quickPhoneticFilter(
  sttText: string,
  vocabularyPhoneticCodes: string[]
): boolean {
  const sttPhonetic = doubleMetaphone(sttText);

  for (const code of vocabularyPhoneticCodes) {
    if (sttPhonetic.primary === code ||
        (sttPhonetic.secondary && sttPhonetic.secondary === code)) {
      return true;
    }
  }

  return false;
}

/**
 * Find entities in text that might need correction
 * Returns words that are potentially misspelled entity names
 */
export function findPotentialEntityWords(
  text: string,
  minLength: number = 3
): string[] {
  // Split on whitespace and punctuation
  const words = text.split(/[\s,.!?;:'"()[\]{}]+/);

  return words.filter(word => {
    // Skip short words
    if (word.length < minLength) return false;
    // Skip stop words
    if (STOP_WORDS.has(word.toLowerCase())) return false;
    // Skip numbers
    if (/^\d+$/.test(word)) return false;
    // Keep words that start with uppercase (potential proper nouns)
    // or contain mixed case (potentially STT errors)
    return /^[A-Z]/.test(word) || /[A-Z]/.test(word.slice(1));
  });
}

/**
 * Compute vocabulary suggestions for a word
 * Used when building the vocabulary - suggests context hints
 */
export function suggestContextHints(
  entityName: string,
  sampleTexts: string[]
): string[] {
  const hintCounts = new Map<string, number>();

  for (const text of sampleTexts) {
    const context = extractContext(text, entityName);
    for (const word of context) {
      hintCounts.set(word, (hintCounts.get(word) || 0) + 1);
    }
  }

  // Return top hints sorted by frequency
  return Array.from(hintCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}
