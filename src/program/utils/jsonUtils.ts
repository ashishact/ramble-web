/**
 * JSON Utilities
 *
 * Handles parsing potentially malformed JSON from LLM responses
 */

import { jsonrepair } from 'jsonrepair';

/**
 * Safely parse JSON, attempting to repair if malformed
 *
 * Handles common LLM JSON issues:
 * - Trailing commas
 * - Unquoted keys
 * - Single quotes instead of double
 * - Missing quotes around strings
 * - Comments
 */
export function safeParseJSON<T = unknown>(text: string): { data: T | null; error: string | null; repaired: boolean } {
  // First try standard parse
  try {
    const data = JSON.parse(text) as T;
    return { data, error: null, repaired: false };
  } catch {
    // Try to repair and parse
    try {
      const repaired = jsonrepair(text);
      const data = JSON.parse(repaired) as T;
      return { data, error: null, repaired: true };
    } catch (e) {
      return {
        data: null,
        error: e instanceof Error ? e.message : 'Unknown parse error',
        repaired: false
      };
    }
  }
}

/**
 * Extract JSON from text that may contain markdown code blocks or other content
 */
export function extractJSON(text: string): string | null {
  // Try to find JSON in markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // Try to find raw JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }

  return null;
}

/**
 * Parse JSON from LLM response - extracts, repairs, and parses
 */
export function parseLLMJSON<T = unknown>(response: string): { data: T | null; error: string | null; repaired: boolean } {
  const jsonText = extractJSON(response);

  if (!jsonText) {
    return { data: null, error: 'No JSON found in response', repaired: false };
  }

  return safeParseJSON<T>(jsonText);
}
