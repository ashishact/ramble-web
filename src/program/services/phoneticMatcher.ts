/**
 * Phonetic Matching for STT Correction
 *
 * Uses Soundex algorithm to find phonetically similar words.
 * Compares input text against known entities.
 */

import { entityStore } from '../../db/stores';

export interface PhoneticMatch {
  inputWord: string;
  matchedEntity: string;
  entityType: string;
  confidence: number; // 0-1 based on how close the match is
}

/**
 * Soundex algorithm - converts word to phonetic code
 * Words that sound similar get the same code
 */
function soundex(word: string): string {
  const s = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';

  const codes: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  let result = s[0];
  let prevCode = codes[s[0]] || '';

  for (let i = 1; i < s.length && result.length < 4; i++) {
    const code = codes[s[i]] || '';
    if (code && code !== prevCode) {
      result += code;
    }
    prevCode = code || prevCode;
  }

  return result.padEnd(4, '0');
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses Levenshtein distance normalized by length
 */
function stringSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  if (la === lb) return 1;

  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return 1;

  // Simple Levenshtein
  const matrix: number[][] = [];
  for (let i = 0; i <= la.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lb.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= la.length; i++) {
    for (let j = 1; j <= lb.length; j++) {
      const cost = la[i - 1] === lb[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[la.length][lb.length];
  return 1 - distance / maxLen;
}

/**
 * Extract words that might be names (capitalized or standalone)
 */
function extractPotentialNames(text: string): string[] {
  // Split on whitespace and punctuation
  const words = text.split(/[\s,.:;!?'"()\[\]{}]+/).filter(w => w.length > 2);

  // Return all words - we'll check them all against entities
  // Could filter for capitalized words, but STT often doesn't preserve case
  return [...new Set(words)];
}

/**
 * Find phonetic matches between input text and known entities
 */
export async function findPhoneticMatches(inputText: string): Promise<PhoneticMatch[]> {
  const matches: PhoneticMatch[] = [];

  // Get known entities (limit to recent/frequent ones for performance)
  const entities = await entityStore.getRecent(50);
  if (entities.length === 0) return [];

  // Build soundex map for entities
  const entitySoundexMap = new Map<string, Array<{ name: string; type: string }>>();
  for (const entity of entities) {
    // Handle multi-word names - use first word for primary matching
    const firstName = entity.name.split(/\s+/)[0];
    const code = soundex(firstName);
    if (!entitySoundexMap.has(code)) {
      entitySoundexMap.set(code, []);
    }
    entitySoundexMap.get(code)!.push({ name: entity.name, type: entity.type });
  }

  // Extract potential names from input
  const inputWords = extractPotentialNames(inputText);

  // Check each input word against entity soundex codes
  for (const word of inputWords) {
    const wordSoundex = soundex(word);
    const candidates = entitySoundexMap.get(wordSoundex);

    if (candidates) {
      for (const candidate of candidates) {
        // Don't match if it's exactly the same
        const firstName = candidate.name.split(/\s+/)[0];
        if (word.toLowerCase() === firstName.toLowerCase()) continue;

        // Calculate confidence based on string similarity
        const similarity = stringSimilarity(word, firstName);

        // Only include if reasonably similar (> 0.4)
        if (similarity > 0.4) {
          matches.push({
            inputWord: word,
            matchedEntity: candidate.name,
            entityType: candidate.type,
            confidence: similarity,
          });
        }
      }
    }
  }

  // Sort by confidence and deduplicate
  matches.sort((a, b) => b.confidence - a.confidence);

  // Keep only the best match per input word
  const seen = new Set<string>();
  return matches.filter(m => {
    if (seen.has(m.inputWord)) return false;
    seen.add(m.inputWord);
    return true;
  });
}

/**
 * Format phonetic matches for LLM prompt
 */
export function formatMatchesForLLM(matches: PhoneticMatch[]): string | null {
  if (matches.length === 0) return null;

  const lines = matches.map(m =>
    `- "${m.inputWord}" might be "${m.matchedEntity}" (${m.entityType})`
  );

  return `## Possible STT Corrections (verify if relevant)
The following words in the input sound similar to known entities.
Use these if they make sense in context, ignore if not relevant:
${lines.join('\n')}`;
}

/**
 * Find spelling matches for typed text (simpler than phonetic)
 * Only catches very close matches (edit distance <= 2)
 */
export async function findSpellingMatches(inputText: string): Promise<PhoneticMatch[]> {
  const matches: PhoneticMatch[] = [];

  // Get known entities
  const entities = await entityStore.getRecent(50);
  if (entities.length === 0) return [];

  // Extract words from input
  const inputWords = inputText.split(/[\s,.:;!?'"()\[\]{}]+/).filter(w => w.length > 3);

  for (const word of inputWords) {
    for (const entity of entities) {
      const firstName = entity.name.split(/\s+/)[0];

      // Skip if exact match
      if (word.toLowerCase() === firstName.toLowerCase()) continue;

      // Only match if very similar (high threshold for typed text)
      const similarity = stringSimilarity(word, firstName);

      // Higher threshold for text (0.7) vs speech (0.4)
      if (similarity >= 0.7 && similarity < 1) {
        matches.push({
          inputWord: word,
          matchedEntity: entity.name,
          entityType: entity.type,
          confidence: similarity,
        });
        break; // One match per word is enough
      }
    }
  }

  return matches;
}
