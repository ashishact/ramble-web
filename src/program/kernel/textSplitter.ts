/**
 * Text Splitter — Sentence-Boundary Chunking for Dense Extraction
 *
 * Splits long normalized text into chunks at sentence boundaries so each
 * chunk gets its own extraction pass. Sequential processing means chunk N+1's
 * context retrieval picks up entities/memories from chunk N.
 *
 * IMPORTANT: This runs AFTER normalization — the input text should already
 * have proper punctuation and sentence boundaries from the normalize step.
 */

// Below this threshold, no splitting needed
const CHUNK_THRESHOLD = 3000

export interface TextChunk {
  text: string
  index: number        // 0-based chunk index
  totalChunks: number
}

/**
 * Split normalized text into chunks at sentence boundaries.
 *
 * - If text is below threshold, returns a single chunk (no-op).
 * - Splits on sentence boundaries: `.` `!` `?` `。` followed by whitespace, or newlines.
 * - Greedily accumulates sentences until adding the next would exceed maxChunkSize.
 * - If a single sentence exceeds maxChunkSize, includes it as-is (never breaks mid-sentence).
 */
export function splitText(text: string, maxChunkSize = CHUNK_THRESHOLD): TextChunk[] {
  if (text.length <= maxChunkSize) {
    return [{ text, index: 0, totalChunks: 1 }]
  }

  // Split by sentence boundaries — lookbehind for sentence-ending punctuation + whitespace
  const sentences = text.split(/(?<=[.!?。\n])\s+/).filter(s => s.trim().length > 0)

  // Edge case: if splitting produced nothing useful, return as single chunk
  if (sentences.length <= 1) {
    return [{ text, index: 0, totalChunks: 1 }]
  }

  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences) {
    const wouldBe = current ? `${current} ${sentence}` : sentence

    if (wouldBe.length > maxChunkSize && current) {
      // Flush current chunk, start new one with this sentence
      chunks.push(current.trim())
      current = sentence
    } else {
      // Accumulate
      current = wouldBe
    }
  }

  // Don't forget the last chunk
  if (current.trim()) {
    chunks.push(current.trim())
  }

  const totalChunks = chunks.length
  return chunks.map((text, index) => ({ text, index, totalChunks }))
}
