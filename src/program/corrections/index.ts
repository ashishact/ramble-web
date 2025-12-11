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
