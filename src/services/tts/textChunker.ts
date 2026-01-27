/**
 * Text chunking utility for TTS
 * Splits text at sentence boundaries for better speech synthesis
 */

/**
 * Split text into chunks at sentence boundaries
 * @param text - The text to split
 * @param maxLen - Maximum chunk length (default: 350)
 * @returns Array of text chunks
 */
export function splitParagraph(text: string, maxLen = 350): string[] {
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
 * Sanitize text for TTS processing
 * - Removes characters that cause issues with Kokoro
 * - Normalizes punctuation for better pauses
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
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
}
