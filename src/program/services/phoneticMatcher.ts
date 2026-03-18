/**
 * Phonetic Matching for STT Correction
 *
 * Uses Soundex algorithm to find phonetically similar words.
 * Compares input text against known entities from DuckDB graph.
 */

import { getEntityStore } from '../../graph/stores/singletons';

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
export function soundex(word: string): string {
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
export function stringSimilarity(a: string, b: string): number {
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
  const words = text.split(/[\s,.:;!?'"()\[\]{}]+/).filter(w => w.length > 2);
  return [...new Set(words)];
}

/**
 * Find phonetic matches between input text and known entities
 */
export async function findPhoneticMatches(inputText: string): Promise<PhoneticMatch[]> {
  const matches: PhoneticMatch[] = [];

  // Get all known entities from DuckDB
  const entityStore = await getEntityStore();
  const entities = await entityStore.getAll();
  if (entities.length === 0) return [];

  // Build soundex map for entities — index every significant word in the name
  const entitySoundexMap = new Map<string, Array<{ name: string; type: string; matchedWord: string }>>();
  for (const entity of entities) {
    const words = entity.name.split(/\s+/).filter(w => w.length > 1);
    for (const word of words) {
      const code = soundex(word);
      if (!code) continue;
      if (!entitySoundexMap.has(code)) {
        entitySoundexMap.set(code, []);
      }
      entitySoundexMap.get(code)!.push({ name: entity.name, type: entity.type, matchedWord: word });
    }
  }

  // Extract potential names from input
  const inputWords = extractPotentialNames(inputText);

  // Check each input word against entity soundex codes
  for (const word of inputWords) {
    const wordSoundex = soundex(word);
    const candidates = entitySoundexMap.get(wordSoundex);

    if (candidates) {
      for (const candidate of candidates) {
        // Don't match if it's exactly the same word
        if (word.toLowerCase() === candidate.matchedWord.toLowerCase()) continue;

        const similarity = stringSimilarity(word, candidate.matchedWord);

        // Lower threshold for person names (0.3) vs general entities (0.4)
        const threshold = candidate.type === 'person' ? 0.3 : 0.4;

        if (similarity > threshold) {
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

  const entityStore = await getEntityStore();
  const entities = await entityStore.getAll();
  if (entities.length === 0) return [];

  const inputWords = inputText.split(/[\s,.:;!?'"()\[\]{}]+/).filter(w => w.length > 3);

  for (const word of inputWords) {
    let bestMatch: PhoneticMatch | null = null;

    for (const entity of entities) {
      const nameWords = entity.name.split(/\s+/).filter(w => w.length > 1);
      for (const nameWord of nameWords) {
        if (word.toLowerCase() === nameWord.toLowerCase()) continue;

        const similarity = stringSimilarity(word, nameWord);

        const threshold = entity.type === 'person' ? 0.6 : 0.7;

        if (similarity >= threshold && similarity < 1) {
          if (!bestMatch || similarity > bestMatch.confidence) {
            bestMatch = {
              inputWord: word,
              matchedEntity: entity.name,
              entityType: entity.type,
              confidence: similarity,
            };
          }
        }
      }
    }

    if (bestMatch) matches.push(bestMatch);
  }

  return matches;
}
