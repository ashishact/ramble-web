/**
 * Phonetic Matcher - Find similar words using Double Metaphone and Edit Distance
 *
 * Used to match STT transcription errors against known entities.
 */

/**
 * Double Metaphone algorithm - encodes words by how they sound
 * Returns [primary, secondary] codes
 */
export function doubleMetaphone(word: string): [string, string] {
  if (!word) return ['', ''];

  const str = word.toUpperCase();
  let primary = '';
  let secondary = '';
  let pos = 0;
  const length = str.length;

  // Helper functions
  const isVowel = (c: string) => 'AEIOU'.includes(c);
  const charAt = (i: number) => (i >= 0 && i < length) ? str[i] : '';
  const substr = (start: number, len: number) => str.slice(start, start + len);

  // Skip initial silent letters
  if (['GN', 'KN', 'PN', 'WR', 'PS'].includes(substr(0, 2))) {
    pos = 1;
  }

  // Initial X becomes S
  if (charAt(0) === 'X') {
    primary += 'S';
    secondary += 'S';
    pos = 1;
  }

  while (pos < length && (primary.length < 4 || secondary.length < 4)) {
    const c = charAt(pos);

    switch (c) {
      case 'A':
      case 'E':
      case 'I':
      case 'O':
      case 'U':
      case 'Y':
        if (pos === 0) {
          primary += 'A';
          secondary += 'A';
        }
        pos++;
        break;

      case 'B':
        primary += 'P';
        secondary += 'P';
        pos += charAt(pos + 1) === 'B' ? 2 : 1;
        break;

      case 'C':
        if (substr(pos, 2) === 'CH') {
          primary += 'X';
          secondary += 'X';
          pos += 2;
        } else if (substr(pos, 2) === 'CK') {
          primary += 'K';
          secondary += 'K';
          pos += 2;
        } else if (['CE', 'CI', 'CY'].includes(substr(pos, 2))) {
          primary += 'S';
          secondary += 'S';
          pos += 1;
        } else {
          primary += 'K';
          secondary += 'K';
          pos += 1;
        }
        break;

      case 'D':
        if (substr(pos, 2) === 'DG') {
          if (['DGE', 'DGI', 'DGY'].some(s => substr(pos, 3) === s)) {
            primary += 'J';
            secondary += 'J';
            pos += 3;
          } else {
            primary += 'TK';
            secondary += 'TK';
            pos += 2;
          }
        } else {
          primary += 'T';
          secondary += 'T';
          pos += substr(pos, 2) === 'DT' || substr(pos, 2) === 'DD' ? 2 : 1;
        }
        break;

      case 'F':
        primary += 'F';
        secondary += 'F';
        pos += charAt(pos + 1) === 'F' ? 2 : 1;
        break;

      case 'G':
        if (charAt(pos + 1) === 'H') {
          if (pos > 0 && !isVowel(charAt(pos - 1))) {
            pos += 2;
          } else if (pos === 0) {
            primary += 'K';
            secondary += 'K';
            pos += 2;
          } else {
            primary += 'F';
            secondary += 'F';
            pos += 2;
          }
        } else if (charAt(pos + 1) === 'N') {
          if (pos === 0) {
            primary += 'KN';
            secondary += 'N';
          } else {
            primary += 'N';
            secondary += 'KN';
          }
          pos += 2;
        } else if (['GE', 'GI', 'GY'].includes(substr(pos, 2))) {
          primary += 'J';
          secondary += 'K';
          pos += 1;
        } else {
          primary += 'K';
          secondary += 'K';
          pos += charAt(pos + 1) === 'G' ? 2 : 1;
        }
        break;

      case 'H':
        if (pos === 0 || isVowel(charAt(pos - 1))) {
          if (isVowel(charAt(pos + 1))) {
            primary += 'H';
            secondary += 'H';
          }
        }
        pos++;
        break;

      case 'J':
        primary += 'J';
        secondary += 'J';
        pos += charAt(pos + 1) === 'J' ? 2 : 1;
        break;

      case 'K':
        primary += 'K';
        secondary += 'K';
        pos += charAt(pos + 1) === 'K' ? 2 : 1;
        break;

      case 'L':
        primary += 'L';
        secondary += 'L';
        pos += charAt(pos + 1) === 'L' ? 2 : 1;
        break;

      case 'M':
        primary += 'M';
        secondary += 'M';
        pos += charAt(pos + 1) === 'M' ? 2 : 1;
        break;

      case 'N':
        primary += 'N';
        secondary += 'N';
        pos += charAt(pos + 1) === 'N' ? 2 : 1;
        break;

      case 'P':
        if (charAt(pos + 1) === 'H') {
          primary += 'F';
          secondary += 'F';
          pos += 2;
        } else {
          primary += 'P';
          secondary += 'P';
          pos += ['P', 'B'].includes(charAt(pos + 1)) ? 2 : 1;
        }
        break;

      case 'Q':
        primary += 'K';
        secondary += 'K';
        pos += charAt(pos + 1) === 'Q' ? 2 : 1;
        break;

      case 'R':
        primary += 'R';
        secondary += 'R';
        pos += charAt(pos + 1) === 'R' ? 2 : 1;
        break;

      case 'S':
        if (substr(pos, 2) === 'SH') {
          primary += 'X';
          secondary += 'X';
          pos += 2;
        } else if (['SIO', 'SIA'].includes(substr(pos, 3))) {
          primary += 'X';
          secondary += 'S';
          pos += 3;
        } else {
          primary += 'S';
          secondary += 'S';
          pos += charAt(pos + 1) === 'S' ? 2 : 1;
        }
        break;

      case 'T':
        if (substr(pos, 3) === 'TCH') {
          pos += 3;
        } else if (substr(pos, 2) === 'TH') {
          primary += '0'; // θ sound
          secondary += 'T';
          pos += 2;
        } else if (['TIO', 'TIA'].includes(substr(pos, 3))) {
          primary += 'X';
          secondary += 'X';
          pos += 3;
        } else {
          primary += 'T';
          secondary += 'T';
          pos += charAt(pos + 1) === 'T' ? 2 : 1;
        }
        break;

      case 'V':
        primary += 'F';
        secondary += 'F';
        pos += charAt(pos + 1) === 'V' ? 2 : 1;
        break;

      case 'W':
        if (isVowel(charAt(pos + 1))) {
          primary += 'A';
          secondary += 'F';
        }
        pos++;
        break;

      case 'X':
        primary += 'KS';
        secondary += 'KS';
        pos += charAt(pos + 1) === 'X' ? 2 : 1;
        break;

      case 'Z':
        primary += 'S';
        secondary += 'S';
        pos += charAt(pos + 1) === 'Z' ? 2 : 1;
        break;

      default:
        pos++;
    }
  }

  return [primary.slice(0, 4), secondary.slice(0, 4)];
}

/**
 * Levenshtein edit distance - measures how different two strings are
 */
export function editDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower[i - 1] === aLower[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[bLower.length][aLower.length];
}

/**
 * Calculate similarity score between two words (0-1, higher is more similar)
 * Combines phonetic and edit distance matching
 */
export function wordSimilarity(word1: string, word2: string): number {
  // Exact match
  if (word1.toLowerCase() === word2.toLowerCase()) return 1;

  // Phonetic match using double metaphone
  const [primary1, secondary1] = doubleMetaphone(word1);
  const [primary2, secondary2] = doubleMetaphone(word2);

  const phoneticMatch =
    primary1 === primary2 ||
    primary1 === secondary2 ||
    secondary1 === primary2 ||
    secondary1 === secondary2;

  // Edit distance score (normalized)
  const maxLen = Math.max(word1.length, word2.length);
  const distance = editDistance(word1, word2);
  const editScore = 1 - (distance / maxLen);

  // Combine scores
  if (phoneticMatch && editScore > 0.5) {
    // Strong match: sounds the same and looks similar
    return 0.9 + (editScore * 0.1);
  } else if (phoneticMatch) {
    // Sounds the same but looks different
    return 0.7 + (editScore * 0.2);
  } else if (editScore > 0.7) {
    // Looks similar but sounds different
    return editScore * 0.8;
  }

  return editScore * 0.5;
}

export interface EntityMatch {
  entityName: string;
  entityType: string;
  matchedAs: string; // The name/alias that matched
  similarity: number;
}

export interface WordCorrection {
  original: string;
  replacement: string;
  matchedAs: string;      // What actually matched (could be alias)
  startIndex: number;
  endIndex: number;
  entityType: string;
  similarity: number;
}

/**
 * Calculate similarity between two phrases (multi-word)
 * Compares word-by-word and averages the scores
 */
export function phraseSimilarity(phrase1: string, phrase2: string): number {
  const words1 = phrase1.split(/\s+/).filter(w => w.length > 0);
  const words2 = phrase2.split(/\s+/).filter(w => w.length > 0);

  // Must have same number of words
  if (words1.length !== words2.length || words1.length === 0) {
    return 0;
  }

  // For single words, use wordSimilarity directly
  if (words1.length === 1) {
    return wordSimilarity(words1[0], words2[0]);
  }

  // Compare word-by-word
  let totalSimilarity = 0;
  for (let i = 0; i < words1.length; i++) {
    totalSimilarity += wordSimilarity(words1[i], words2[i]);
  }

  return totalSimilarity / words1.length;
}

/**
 * Find potential entity matches for a word
 */
export function findEntityMatches(
  word: string,
  entities: Array<{ name: string; type: string; aliases: string[] }>,
  minSimilarity = 0.7
): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const wordLower = word.toLowerCase();

  for (const entity of entities) {
    // Check against entity name
    const nameSimilarity = wordSimilarity(word, entity.name);
    if (nameSimilarity >= minSimilarity && wordLower !== entity.name.toLowerCase()) {
      matches.push({
        entityName: entity.name,
        entityType: entity.type,
        matchedAs: entity.name,
        similarity: nameSimilarity,
      });
    }

    // Check against aliases
    for (const alias of entity.aliases) {
      const aliasSimilarity = wordSimilarity(word, alias);
      if (aliasSimilarity >= minSimilarity && wordLower !== alias.toLowerCase()) {
        matches.push({
          entityName: entity.name,
          entityType: entity.type,
          matchedAs: alias,
          similarity: aliasSimilarity,
        });
      }
    }
  }

  // Sort by similarity descending
  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Find potential multi-word phrase matches against multi-word entities
 */
export function findPhraseMatches(
  phrase: string,
  entities: Array<{ name: string; type: string; aliases: string[] }>,
  minSimilarity = 0.7
): EntityMatch[] {
  const matches: EntityMatch[] = [];
  const phraseLower = phrase.toLowerCase();

  for (const entity of entities) {
    // Check against entity name
    const nameSimilarity = phraseSimilarity(phrase, entity.name);
    if (nameSimilarity >= minSimilarity && phraseLower !== entity.name.toLowerCase()) {
      matches.push({
        entityName: entity.name,
        entityType: entity.type,
        matchedAs: entity.name,
        similarity: nameSimilarity,
      });
    }

    // Check against aliases
    for (const alias of entity.aliases) {
      const aliasSimilarity = phraseSimilarity(phrase, alias);
      if (aliasSimilarity >= minSimilarity && phraseLower !== alias.toLowerCase()) {
        matches.push({
          entityName: entity.name,
          entityType: entity.type,
          matchedAs: alias,
          similarity: aliasSimilarity,
        });
      }
    }
  }

  // Sort by similarity descending
  return matches.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Find all positions where entities already appear correctly in the text
 */
function findExistingEntityRegions(
  text: string,
  entities: Array<{ name: string; type: string; aliases: string[] }>
): Array<{ start: number; end: number }> {
  const regions: Array<{ start: number; end: number }> = [];
  const textLower = text.toLowerCase();

  for (const entity of entities) {
    // Check entity name
    let pos = 0;
    while ((pos = textLower.indexOf(entity.name.toLowerCase(), pos)) !== -1) {
      regions.push({ start: pos, end: pos + entity.name.length });
      pos += entity.name.length;
    }

    // Check aliases
    for (const alias of entity.aliases) {
      pos = 0;
      while ((pos = textLower.indexOf(alias.toLowerCase(), pos)) !== -1) {
        regions.push({ start: pos, end: pos + alias.length });
        pos += alias.length;
      }
    }
  }

  return regions;
}

/**
 * Check if a position falls within any of the protected regions
 */
function isInProtectedRegion(
  start: number,
  end: number,
  regions: Array<{ start: number; end: number }>
): boolean {
  for (const region of regions) {
    // Check if there's any overlap
    if (start < region.end && end > region.start) {
      return true;
    }
  }
  return false;
}

/**
 * Analyze text and find all potential corrections
 */
export function analyzeText(
  text: string,
  entities: Array<{ name: string; type: string; aliases: string[] }>,
  minSimilarity = 0.7
): WordCorrection[] {
  const corrections: WordCorrection[] = [];

  // First, find all regions where entities already appear correctly
  const protectedRegions = findExistingEntityRegions(text, entities);

  // Separate single-word and multi-word entities
  const singleWordEntities = entities.filter(e => !e.name.includes(' ')).map(e => ({
    ...e,
    aliases: e.aliases.filter(a => !a.includes(' '))
  }));

  const multiWordEntities = entities.filter(e => e.name.includes(' ')).map(e => ({
    ...e,
    aliases: e.aliases.filter(a => a.includes(' '))
  }));

  // Extract all words with positions
  const wordRegex = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
  const words: Array<{ word: string; start: number; end: number }> = [];
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    words.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // Track which word indices are already part of a multi-word correction
  const usedWordIndices = new Set<number>();

  // First pass: check multi-word phrases (prioritize longer matches)
  // Group multi-word entities by word count
  const entitiesByWordCount = new Map<number, typeof multiWordEntities>();
  for (const entity of multiWordEntities) {
    const wordCount = entity.name.split(/\s+/).length;
    if (!entitiesByWordCount.has(wordCount)) {
      entitiesByWordCount.set(wordCount, []);
    }
    entitiesByWordCount.get(wordCount)!.push(entity);
  }

  // Check from longest to shortest phrases
  const wordCounts = Array.from(entitiesByWordCount.keys()).sort((a, b) => b - a);

  for (const wordCount of wordCounts) {
    const entitiesOfLength = entitiesByWordCount.get(wordCount)!;

    // Slide window of wordCount consecutive words
    for (let i = 0; i <= words.length - wordCount; i++) {
      // Skip if any word in this window is already used
      let anyUsed = false;
      for (let j = 0; j < wordCount; j++) {
        if (usedWordIndices.has(i + j)) {
          anyUsed = true;
          break;
        }
      }
      if (anyUsed) continue;

      // Build the phrase from consecutive words
      const phraseWords = words.slice(i, i + wordCount);
      const phraseStart = phraseWords[0].start;
      const phraseEnd = phraseWords[phraseWords.length - 1].end;
      const phrase = phraseWords.map(w => w.word).join(' ');

      // Skip if protected
      if (isInProtectedRegion(phraseStart, phraseEnd, protectedRegions)) {
        continue;
      }

      // Find matches against multi-word entities of this length
      const phraseMatches = findPhraseMatches(
        phrase,
        entitiesOfLength,
        minSimilarity
      );

      if (phraseMatches.length > 0) {
        const bestMatch = phraseMatches[0];
        corrections.push({
          original: text.slice(phraseStart, phraseEnd),
          replacement: bestMatch.entityName,
          matchedAs: bestMatch.matchedAs,
          startIndex: phraseStart,
          endIndex: phraseEnd,
          entityType: bestMatch.entityType,
          similarity: bestMatch.similarity,
        });

        // Mark these word indices as used
        for (let j = 0; j < wordCount; j++) {
          usedWordIndices.add(i + j);
        }
      }
    }
  }

  // Second pass: check single words (skip words that are part of multi-word corrections)
  for (let i = 0; i < words.length; i++) {
    if (usedWordIndices.has(i)) continue;

    const { word, start: startIndex, end: endIndex } = words[i];

    // Skip very short words
    if (word.length < 3) continue;

    // Skip if this word is part of an already-correct entity
    if (isInProtectedRegion(startIndex, endIndex, protectedRegions)) {
      continue;
    }

    // Find entity matches (only against single-word entities)
    const entityMatches = findEntityMatches(word, singleWordEntities, minSimilarity);

    if (entityMatches.length > 0) {
      const bestMatch = entityMatches[0];
      corrections.push({
        original: word,
        replacement: bestMatch.entityName,
        matchedAs: bestMatch.matchedAs,
        startIndex,
        endIndex,
        entityType: bestMatch.entityType,
        similarity: bestMatch.similarity,
      });
    }
  }

  // Sort by position for consistent display
  return corrections.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Apply corrections to text and return the corrected version
 */
export function applyCorrections(text: string, corrections: WordCorrection[]): string {
  // Sort corrections by position descending to apply from end to start
  const sorted = [...corrections].sort((a, b) => b.startIndex - a.startIndex);

  let result = text;
  for (const correction of sorted) {
    result = result.slice(0, correction.startIndex) +
             correction.replacement +
             result.slice(correction.endIndex);
  }

  return result;
}

// ============================================================================
// DIFF & LEARNING SYSTEM
// Detects word-level changes between original and edited text
// ============================================================================

interface TokenizedWord {
  word: string;
  start: number;
  end: number;
  index: number;  // Position in word array
}

/**
 * Tokenize text into words with positions
 */
export function tokenizeText(text: string): TokenizedWord[] {
  const wordRegex = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
  const words: TokenizedWord[] = [];
  let match;
  let index = 0;

  while ((match = wordRegex.exec(text)) !== null) {
    words.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
      index: index++,
    });
  }

  return words;
}

/**
 * Detected change from diff
 */
export interface DetectedChange {
  original: string;           // The original word(s)
  corrected: string;          // What it was changed to
  leftContext: string[];      // Up to 3 words before
  rightContext: string[];     // Up to 3 words after
  originalIndex: number;      // Index in original word array
}

/**
 * Edit operation types for word-level diff
 */
type EditOp =
  | { type: 'match'; origIdx: number; editIdx: number }
  | { type: 'substitute'; origIdx: number; editIdx: number }
  | { type: 'insert'; editIdx: number }
  | { type: 'delete'; origIdx: number };

/**
 * Compute word-level diff between original and edited text
 * Uses Edit Distance (Levenshtein) algorithm at word level with backtracking
 *
 * This properly handles:
 * - Simple replacements (word A → word B)
 * - Word splits (one word → multiple words)
 * - Insertions (new word added)
 * - Deletions (word removed)
 * - Multiple simultaneous edits anywhere in text
 */
export function computeWordDiff(
  originalText: string,
  editedText: string
): DetectedChange[] {
  const originalWords = tokenizeText(originalText);
  const editedWords = tokenizeText(editedText);

  if (originalWords.length === 0 && editedWords.length === 0) {
    return [];
  }

  const origArr = originalWords.map((w) => w.word);
  const editArr = editedWords.map((w) => w.word);

  // Build edit distance matrix
  const ops = computeEditOperations(origArr, editArr);

  // Convert operations to DetectedChange format
  // Use two passes: first identify word splits, then handle remaining changes
  const changes: DetectedChange[] = [];

  // Pass 1: Pre-process to detect word splits
  // A word split is when: insert(s) + substitute where original contains substitute target
  // e.g., "Charantandi" → insert "Charan" + substitute "Charantandi"→"Tandi"
  // Should become: "Charantandi" → "Charan Tandi"
  const processedOps = detectWordSplits(ops, origArr, editArr);

  let i = 0;
  while (i < processedOps.length) {
    const op = processedOps[i];

    if (op.type === 'split') {
      // Word split detected
      const leftContext = getWordContext(origArr.map(w => w.toLowerCase()), op.origIdx, 'left', 3);
      const rightContext = getWordContext(origArr.map(w => w.toLowerCase()), op.origIdx, 'right', 3);

      changes.push({
        original: origArr[op.origIdx],
        corrected: op.combined,
        leftContext,
        rightContext,
        originalIndex: op.origIdx,
      });
      i++;
    } else if (op.type === 'substitute') {
      // Simple replacement
      const leftContext = getWordContext(origArr.map(w => w.toLowerCase()), op.origIdx, 'left', 3);
      const rightContext = getWordContext(origArr.map(w => w.toLowerCase()), op.origIdx, 'right', 3);

      changes.push({
        original: origArr[op.origIdx],
        corrected: editArr[op.editIdx],
        leftContext,
        rightContext,
        originalIndex: op.origIdx,
      });
      i++;
    } else if (op.type === 'delete') {
      // Check if this delete is followed by inserts (word split scenario)
      const inserts: number[] = [];
      let j = i + 1;
      while (j < processedOps.length && processedOps[j].type === 'insert') {
        inserts.push((processedOps[j] as { type: 'insert'; editIdx: number }).editIdx);
        j++;
      }

      if (inserts.length > 0) {
        // Word was split or replaced with multiple words
        const combinedEdit = inserts.map(idx => editArr[idx]).join(' ');
        const leftContext = getWordContext(origArr.map(w => w.toLowerCase()), op.origIdx, 'left', 3);
        const rightContext = getWordContext(origArr.map(w => w.toLowerCase()), op.origIdx, 'right', 3);

        changes.push({
          original: origArr[op.origIdx],
          corrected: combinedEdit,
          leftContext,
          rightContext,
          originalIndex: op.origIdx,
        });
        i = j; // Skip past the inserts we consumed
      } else {
        // Pure deletion - we don't track these for learning
        i++;
      }
    } else if (op.type === 'insert') {
      // Skip pure insertions - we mainly care about corrections
      i++;
    } else {
      // Match - no change
      i++;
    }
  }

  return changes;
}

/**
 * Extended operation type that includes word splits
 */
type ProcessedOp = EditOp | { type: 'split'; origIdx: number; combined: string };

/**
 * Detect word splits in the operation sequence
 *
 * A word split occurs when:
 * - Pattern 1: insert(s) followed by substitute, where original word contains the substitute target
 *   e.g., "Charantandi" → insert "Charan" + sub "Charantandi"→"Tandi"
 *   The original "Charantandi" contains "Tandi", so this is a split
 *
 * - Pattern 2: substitute followed by insert(s), where original word starts with substitute target
 *   e.g., sub "Charantandi"→"Charan" + insert "Tandi"
 */
function detectWordSplits(ops: EditOp[], origArr: string[], editArr: string[]): ProcessedOp[] {
  const result: ProcessedOp[] = [];
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];

    // Pattern 1: insert(s) + substitute where original contains substitute target
    if (op.type === 'insert') {
      const insertedWords: string[] = [editArr[op.editIdx]];
      let j = i + 1;

      // Collect consecutive inserts
      while (j < ops.length && ops[j].type === 'insert') {
        insertedWords.push(editArr[(ops[j] as { type: 'insert'; editIdx: number }).editIdx]);
        j++;
      }

      // Check if followed by a substitute
      if (j < ops.length && ops[j].type === 'substitute') {
        const subOp = ops[j] as { type: 'substitute'; origIdx: number; editIdx: number };
        const originalWord = origArr[subOp.origIdx].toLowerCase();
        const substitutedWith = editArr[subOp.editIdx].toLowerCase();

        // Check if original contains the substituted word (likely a split)
        // e.g., "charantandi" contains "tandi"
        if (originalWord.includes(substitutedWith) && substitutedWith.length >= 3) {
          // This is a word split!
          insertedWords.push(editArr[subOp.editIdx]);
          result.push({
            type: 'split',
            origIdx: subOp.origIdx,
            combined: insertedWords.join(' '),
          });
          i = j + 1;
          continue;
        }
      }

      // Not a split, add inserts as-is
      for (let k = i; k < j; k++) {
        result.push(ops[k]);
      }
      i = j;
      continue;
    }

    // Pattern 2: substitute + insert(s) where original starts with substitute target
    if (op.type === 'substitute') {
      const originalWord = origArr[op.origIdx].toLowerCase();
      const substitutedWith = editArr[op.editIdx].toLowerCase();

      // Check if there are following inserts
      const insertedWords: string[] = [];
      let j = i + 1;
      while (j < ops.length && ops[j].type === 'insert') {
        insertedWords.push(editArr[(ops[j] as { type: 'insert'; editIdx: number }).editIdx]);
        j++;
      }

      if (insertedWords.length > 0) {
        // Check if this looks like a word split
        // Either: original starts with substitute (e.g., "Charantandi" starts with "Charan")
        // Or: original ends with one of the inserts
        const combined = [editArr[op.editIdx], ...insertedWords].join(' ');
        const combinedNoSpaces = combined.replace(/\s+/g, '').toLowerCase();

        // Check if the combined result is similar to original (character-wise)
        // This catches cases like "Charantandi" → "Charan Tandi"
        if (
          originalWord.startsWith(substitutedWith) ||
          originalWord === combinedNoSpaces ||
          levenshteinSimilarity(originalWord, combinedNoSpaces) > 0.8
        ) {
          result.push({
            type: 'split',
            origIdx: op.origIdx,
            combined,
          });
          i = j;
          continue;
        }
      }

      // Not a split, add substitute as-is
      result.push(op);
      i++;
      continue;
    }

    // All other operations pass through
    result.push(op);
    i++;
  }

  return result;
}

/**
 * Calculate Levenshtein similarity between two strings (0-1)
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = editDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Compute edit operations using dynamic programming
 * Returns the sequence of operations to transform original → edited
 */
function computeEditOperations(orig: string[], edit: string[]): EditOp[] {
  const m = orig.length;
  const n = edit.length;

  // dp[i][j] = min operations to transform orig[0..i-1] to edit[0..j-1]
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= m; i++) dp[i][0] = i; // Delete all
  for (let j = 0; j <= n; j++) dp[0][j] = j; // Insert all

  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (orig[i - 1].toLowerCase() === edit[j - 1].toLowerCase()) {
        // Match (case-insensitive)
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // Delete
          dp[i][j - 1],     // Insert
          dp[i - 1][j - 1]  // Substitute
        );
      }
    }
  }

  // Backtrack to find operations
  const ops: EditOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && orig[i - 1].toLowerCase() === edit[j - 1].toLowerCase()) {
      // Match
      ops.unshift({ type: 'match', origIdx: i - 1, editIdx: j - 1 });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      // Substitute
      ops.unshift({ type: 'substitute', origIdx: i - 1, editIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      // Insert
      ops.unshift({ type: 'insert', editIdx: j - 1 });
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      // Delete
      ops.unshift({ type: 'delete', origIdx: i - 1 });
      i--;
    } else {
      // Shouldn't happen, but handle gracefully
      if (j > 0) {
        ops.unshift({ type: 'insert', editIdx: j - 1 });
        j--;
      } else if (i > 0) {
        ops.unshift({ type: 'delete', origIdx: i - 1 });
        i--;
      }
    }
  }

  return ops;
}

/**
 * Get context words around a position
 */
function getWordContext(
  words: string[],
  position: number,
  direction: 'left' | 'right',
  count: number
): string[] {
  if (direction === 'left') {
    const start = Math.max(0, position - count);
    return words.slice(start, position);
  } else {
    const end = Math.min(words.length, position + 1 + count);
    return words.slice(position + 1, end);
  }
}
