/**
 * Corrections Module
 *
 * Auto-correction system for STT spelling mistakes.
 * Learns from user corrections and applies them to future transcripts.
 */

export { parseCorrections, mightContainCorrection, type ParsedCorrection, type CorrectionParseResult } from './correctionParser';
export { applyCorrections, wouldCorrect, getSuggestions, type ApplyResult } from './correctionApplier';
export {
  CorrectionService,
  createCorrectionService,
  type ProcessTextResult,
  type CorrectionServiceConfig,
} from './correctionService';

// Phonetic matching
export {
  doubleMetaphone,
  phoneticMatch,
  phoneticSimilarity,
  type DoubleMetaphoneResult,
} from './doubleMetaphone';

// Edit distance
export {
  levenshteinDistance,
  stringSimilarity,
  isWithinEditThreshold,
  getEditThreshold,
  damerauLevenshteinDistance,
  findBestMatches,
  jaroWinklerSimilarity,
  type FuzzyMatch,
} from './levenshtein';

// Context matching
export {
  extractContext,
  calculateContextScore,
  scoreWithContext,
  quickPhoneticFilter,
  findPotentialEntityWords,
  suggestContextHints,
  type ContextMatch,
} from './contextMatcher';
