/**
 * Correction Applier
 *
 * Applies learned corrections to text, preserving original casing.
 * Uses word boundary matching to avoid partial word replacements.
 */

import type { Correction } from '../types';
import type { ICorrectionStore } from '../interfaces/store';
import { createLogger } from '../utils/logger';

const logger = createLogger('CorrectionApplier');

export interface ApplyResult {
  correctedText: string;
  appliedCorrections: Array<{
    correction: Correction;
    originalWord: string;
    replacedWith: string;
  }>;
  correctionCount: number;
}

/**
 * Apply all corrections from the store to the given text
 */
export function applyCorrections(text: string, store: ICorrectionStore): ApplyResult {
  const corrections = store.getAll();
  const appliedCorrections: ApplyResult['appliedCorrections'] = [];
  let correctedText = text;

  // Sort corrections by wrong_text length (longest first) to handle overlapping corrections
  const sortedCorrections = [...corrections].sort((a, b) => b.wrongText.length - a.wrongText.length);

  for (const correction of sortedCorrections) {
    // Create a case-insensitive word boundary regex
    const escapedWrong = escapeRegex(correction.wrongText);
    const regex = new RegExp(`\\b${escapedWrong}\\b`, 'gi');

    let match: RegExpExecArray | null;
    const matches: Array<{ index: number; matchedText: string }> = [];

    // Find all matches first
    while ((match = regex.exec(correctedText)) !== null) {
      matches.push({ index: match.index, matchedText: match[0] });
    }

    // Apply corrections (reverse order to preserve indices)
    for (let i = matches.length - 1; i >= 0; i--) {
      const { index, matchedText } = matches[i];
      const replacement = preserveCase(matchedText, correction.originalCase);

      correctedText = correctedText.slice(0, index) + replacement + correctedText.slice(index + matchedText.length);

      appliedCorrections.push({
        correction,
        originalWord: matchedText,
        replacedWith: replacement,
      });

      // Increment usage count for this correction
      store.incrementUsageCount(correction.id);

      logger.debug('Applied correction', {
        wrong: matchedText,
        correct: replacement,
        correctionId: correction.id,
      });
    }
  }

  return {
    correctedText,
    appliedCorrections,
    correctionCount: appliedCorrections.length,
  };
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Preserve the case pattern of the original word when applying correction
 */
function preserveCase(original: string, replacement: string): string {
  if (original.length === 0) return replacement;

  // All uppercase
  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }

  // All lowercase
  if (original === original.toLowerCase()) {
    return replacement.toLowerCase();
  }

  // Title case (first letter uppercase, rest lowercase)
  if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }

  // Mixed case - use the original_case from correction
  return replacement;
}

/**
 * Check if a specific word would be corrected
 */
export function wouldCorrect(word: string, store: ICorrectionStore): Correction | null {
  return store.getByWrongText(word);
}

/**
 * Get suggestions for a word (for UI autocomplete)
 */
export function getSuggestions(partialWord: string, store: ICorrectionStore, limit = 5): Correction[] {
  const corrections = store.getAll();
  const lowerPartial = partialWord.toLowerCase();

  return corrections
    .filter((c) => c.wrongText.startsWith(lowerPartial) || c.correctText.toLowerCase().startsWith(lowerPartial))
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, limit);
}
