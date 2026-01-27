/**
 * Text chunking utility for TTS
 * Splits text at paragraph boundaries first, then sentence boundaries
 */

export interface TextChunk {
  text: string;
  isFirstInParagraph: boolean; // For UI: add margin-top before this chunk
}

/**
 * Split a single paragraph at sentence boundaries
 * @param text - The paragraph text to split
 * @param maxLen - Maximum chunk length (default: 350)
 * @returns Array of text chunks
 */
function splitSentences(text: string, maxLen = 350): string[] {
  const result: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLen;
    if (end >= text.length) {
      result.push(text.slice(start).trim());
      break;
    }

    // Try to split at sentence boundary (period, exclamation, question mark)
    let splitAt = -1;
    for (const punct of ['.', '!', '?']) {
      const idx = text.lastIndexOf(punct, end);
      if (idx > start && idx > splitAt) {
        splitAt = idx;
      }
    }

    // If no sentence boundary found, try to split at space
    if (splitAt <= start) {
      splitAt = text.lastIndexOf(' ', end);
      if (splitAt <= start) {
        splitAt = end;
      }
    }

    result.push(text.slice(start, splitAt + 1).trim());
    start = splitAt + 1;
  }

  return result.filter(chunk => chunk.length > 0);
}

/**
 * Split text into chunks - paragraphs first, then sentences
 * Each paragraph becomes its own chunk(s), preserving structure
 * @param text - The text to split
 * @param maxLen - Maximum chunk length (default: 350)
 * @returns Array of text chunks with paragraph metadata
 */
export function splitParagraph(text: string, maxLen = 350): TextChunk[] {
  const result: TextChunk[] = [];

  // Split by newlines first (paragraphs)
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);

  for (const paragraph of paragraphs) {
    // Split each paragraph into sentences if needed
    const sentences = splitSentences(paragraph, maxLen);

    sentences.forEach((sentence, idx) => {
      result.push({
        text: sentence,
        isFirstInParagraph: idx === 0,
      });
    });
  }

  return result;
}

/**
 * Legacy function - returns just strings (for backwards compatibility)
 */
export function splitParagraphSimple(text: string, maxLen = 350): string[] {
  return splitParagraph(text, maxLen).map(chunk => chunk.text);
}

/**
 * Sanitize text for TTS processing
 * - Removes characters that cause issues with Kokoro
 * - Normalizes punctuation for better pauses
 * - Preserves newlines for paragraph detection
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/\*/g, '') // Kokoro doesn't like asterisks
    // Normalize dashes to create pauses
    .replace(/—/g, ', ') // Em-dash → comma (creates pause)
    .replace(/–/g, ', ') // En-dash → comma
    .replace(/\s*-\s*/g, ', ') // Spaced hyphen → comma
    // Add pause after question marks (Kokoro sometimes rushes past them)
    .replace(/\?\s*/g, '? ... ')
    // Preserve paragraph breaks but normalize them
    .replace(/\r\n/g, '\n') // Normalize Windows line endings
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    // Collapse multiple spaces (but not newlines)
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

/**
 * Sanitize a single chunk for TTS (removes newlines since it's already split)
 */
export function sanitizeChunk(text: string): string {
  return text
    .replace(/\*/g, '')
    .replace(/—/g, ', ')
    .replace(/–/g, ', ')
    .replace(/\s*-\s*/g, ', ')
    .replace(/\?\s*/g, '? ... ')
    .replace(/\s+/g, ' ')
    .trim();
}
