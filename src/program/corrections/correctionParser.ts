/**
 * Correction Parser
 *
 * Detects correction statements in user input and extracts the wrong/correct pairs.
 * Supports patterns like:
 * - "I meant X not Y"
 * - "X not Y" / "X, not Y"
 * - "It's X not Y"
 * - "That should be X not Y"
 * - "I said X but I meant Y"
 * - "Correct X to Y"
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('CorrectionParser');

export interface ParsedCorrection {
  wrongText: string;
  correctText: string;
  originalCase: string; // Preserves original casing of correct_text
  confidence: number; // 0-1 confidence in the detection
}

export interface CorrectionParseResult {
  isCorrection: boolean;
  corrections: ParsedCorrection[];
  remainingText: string; // Text after removing correction statements
}

// Patterns for detecting corrections (ordered by specificity)
const CORRECTION_PATTERNS: Array<{
  regex: RegExp;
  wrongIndex: number;
  correctIndex: number;
  confidence: number;
}> = [
  // "I meant X not Y" - correct first, wrong second
  {
    regex: /\bi\s+meant\s+["']?([^"',]+?)["']?\s+not\s+["']?([^"',\.]+?)["']?(?:\s|$|[,\.])/gi,
    correctIndex: 1,
    wrongIndex: 2,
    confidence: 0.95,
  },
  // "It's X not Y" - correct first, wrong second
  {
    regex: /\bit'?s\s+["']?([^"',]+?)["']?\s+not\s+["']?([^"',\.]+?)["']?(?:\s|$|[,\.])/gi,
    correctIndex: 1,
    wrongIndex: 2,
    confidence: 0.9,
  },
  // "that should be X not Y" - correct first, wrong second
  {
    regex: /\b(?:that\s+)?should\s+be\s+["']?([^"',]+?)["']?\s+not\s+["']?([^"',\.]+?)["']?(?:\s|$|[,\.])/gi,
    correctIndex: 1,
    wrongIndex: 2,
    confidence: 0.9,
  },
  // "I said X but I meant Y" - wrong first, correct second
  {
    regex: /\bi\s+said\s+["']?([^"',]+?)["']?\s+but\s+(?:i\s+)?meant\s+["']?([^"',\.]+?)["']?(?:\s|$|[,\.])/gi,
    wrongIndex: 1,
    correctIndex: 2,
    confidence: 0.95,
  },
  // "correct X to Y" - wrong first, correct second
  {
    regex: /\bcorrect\s+["']?([^"',]+?)["']?\s+to\s+["']?([^"',\.]+?)["']?(?:\s|$|[,\.])/gi,
    wrongIndex: 1,
    correctIndex: 2,
    confidence: 0.9,
  },
  // "change X to Y" - wrong first, correct second
  {
    regex: /\bchange\s+["']?([^"',]+?)["']?\s+to\s+["']?([^"',\.]+?)["']?(?:\s|$|[,\.])/gi,
    wrongIndex: 1,
    correctIndex: 2,
    confidence: 0.85,
  },
  // "X, not Y" or "X not Y" (standalone, less confident) - correct first, wrong second
  {
    regex: /\b["']?([A-Z][a-zA-Z]+)["']?,?\s+not\s+["']?([A-Z][a-zA-Z]+)["']?(?:\s|$|[,\.])/g,
    correctIndex: 1,
    wrongIndex: 2,
    confidence: 0.7,
  },
  // "spell it X" or "spelled X" - just the correct, need context for wrong
  // This pattern is handled separately as it requires inferring the wrong text
];

/**
 * Parse text for correction statements
 */
export function parseCorrections(text: string): CorrectionParseResult {
  const corrections: ParsedCorrection[] = [];
  let remainingText = text;
  const matchedSpans: Array<{ start: number; end: number }> = [];

  for (const pattern of CORRECTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const wrongText = match[pattern.wrongIndex]?.trim();
      const correctText = match[pattern.correctIndex]?.trim();

      if (wrongText && correctText && wrongText.toLowerCase() !== correctText.toLowerCase()) {
        // Check if this span overlaps with already matched spans
        const start = match.index;
        const end = match.index + match[0].length;
        const overlaps = matchedSpans.some(
          (span) => (start >= span.start && start < span.end) || (end > span.start && end <= span.end)
        );

        if (!overlaps) {
          corrections.push({
            wrongText: wrongText,
            correctText: correctText,
            originalCase: correctText,
            confidence: pattern.confidence,
          });
          matchedSpans.push({ start, end });
          logger.debug('Found correction', { wrong: wrongText, correct: correctText, confidence: pattern.confidence });
        }
      }
    }
  }

  // Remove matched correction statements from the remaining text
  // Sort spans in reverse order to remove from end first
  matchedSpans.sort((a, b) => b.start - a.start);
  for (const span of matchedSpans) {
    remainingText = remainingText.slice(0, span.start) + remainingText.slice(span.end);
  }

  // Clean up remaining text (remove double spaces, trim)
  remainingText = remainingText.replace(/\s+/g, ' ').trim();

  return {
    isCorrection: corrections.length > 0,
    corrections,
    remainingText,
  };
}

/**
 * Quick check if text likely contains a correction statement
 */
export function mightContainCorrection(text: string): boolean {
  const lowerText = text.toLowerCase();
  const keywords = ['meant', 'not', 'should be', 'correct', 'change', 'spelled', 'spell it'];
  return keywords.some((kw) => lowerText.includes(kw));
}
