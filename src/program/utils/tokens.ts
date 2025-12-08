/**
 * Token Estimation Utilities
 *
 * Estimate token counts for text without using a full tokenizer.
 * Uses a simple heuristic based on character and word counts.
 */

/**
 * Estimate token count for a string
 * Uses the rule of thumb: ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Average of character-based and word-based estimates
  const charEstimate = Math.ceil(text.length / 4);
  const wordEstimate = Math.ceil(text.split(/\s+/).length * 1.3);

  return Math.ceil((charEstimate + wordEstimate) / 2);
}

/**
 * Truncate text to fit within a token budget
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) {
    return text;
  }

  // Estimate characters to keep
  const ratio = maxTokens / currentTokens;
  const charsToKeep = Math.floor(text.length * ratio * 0.9); // 10% safety margin

  return text.substring(0, charsToKeep) + '...';
}

/**
 * Check if text fits within a token budget
 */
export function fitsInBudget(text: string, budget: number): boolean {
  return estimateTokens(text) <= budget;
}

/**
 * Calculate remaining tokens after some text
 */
export function remainingTokens(totalBudget: number, usedText: string): number {
  return Math.max(0, totalBudget - estimateTokens(usedText));
}
