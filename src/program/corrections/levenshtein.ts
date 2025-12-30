/**
 * Levenshtein Distance Implementation
 *
 * Edit distance algorithm for fuzzy string matching.
 * Uses Wagner-Fischer algorithm with O(min(m,n)) space optimization.
 */

/**
 * Calculate Levenshtein (edit) distance between two strings
 * Returns the minimum number of single-character edits needed
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  // Ensure a is the shorter string for space optimization
  const [short, long] = aLower.length <= bLower.length ? [aLower, bLower] : [bLower, aLower];

  const shortLen = short.length;
  const longLen = long.length;

  // Previous and current row of distances
  let prevRow = new Array<number>(shortLen + 1);
  let currRow = new Array<number>(shortLen + 1);

  // Initialize first row
  for (let i = 0; i <= shortLen; i++) {
    prevRow[i] = i;
  }

  // Fill in the rest of the matrix
  for (let j = 1; j <= longLen; j++) {
    currRow[0] = j;

    for (let i = 1; i <= shortLen; i++) {
      const cost = short[i - 1] === long[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        prevRow[i] + 1,      // deletion
        currRow[i - 1] + 1,  // insertion
        prevRow[i - 1] + cost // substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[shortLen];
}

/**
 * Calculate normalized similarity score (0-1)
 * 1.0 = identical, 0.0 = completely different
 */
export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Check if two strings are within acceptable edit distance
 * Threshold varies by string length:
 * - 1-4 chars: max 1 edit
 * - 5-8 chars: max 2 edits
 * - 9+ chars: max 3 edits
 */
export function isWithinEditThreshold(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const threshold = getEditThreshold(maxLen);
  return levenshteinDistance(a, b) <= threshold;
}

/**
 * Get edit distance threshold based on string length
 */
export function getEditThreshold(length: number): number {
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  return 3;
}

/**
 * Damerau-Levenshtein distance (includes transpositions)
 * Useful for typos where adjacent characters are swapped
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  const lenA = aLower.length;
  const lenB = bLower.length;

  // Create matrix
  const matrix: number[][] = [];
  for (let i = 0; i <= lenA; i++) {
    matrix[i] = new Array(lenB + 1);
    matrix[i][0] = i;
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );

      // Transposition
      if (i > 1 && j > 1 &&
          aLower[i - 1] === bLower[j - 2] &&
          aLower[i - 2] === bLower[j - 1]) {
        matrix[i][j] = Math.min(
          matrix[i][j],
          matrix[i - 2][j - 2] + cost // transposition
        );
      }
    }
  }

  return matrix[lenA][lenB];
}

/**
 * Find best matches from a list of candidates
 */
export interface FuzzyMatch {
  value: string;
  distance: number;
  similarity: number;
}

export function findBestMatches(
  query: string,
  candidates: string[],
  maxDistance?: number
): FuzzyMatch[] {
  const threshold = maxDistance ?? getEditThreshold(query.length);

  const matches: FuzzyMatch[] = [];

  for (const candidate of candidates) {
    const distance = levenshteinDistance(query, candidate);
    if (distance <= threshold) {
      matches.push({
        value: candidate,
        distance,
        similarity: stringSimilarity(query, candidate),
      });
    }
  }

  // Sort by distance (ascending), then by similarity (descending)
  return matches.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.similarity - a.similarity;
  });
}

/**
 * Jaro-Winkler similarity (good for names)
 * Returns value between 0 and 1
 */
export function jaroWinklerSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 1.0;
  if (aLower.length === 0 || bLower.length === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(aLower.length, bLower.length) / 2) - 1;
  const aMatches = new Array(aLower.length).fill(false);
  const bMatches = new Array(bLower.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < aLower.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, bLower.length);

    for (let j = start; j < end; j++) {
      if (bMatches[j] || aLower[i] !== bLower[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < aLower.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (aLower[i] !== bLower[k]) transpositions++;
    k++;
  }

  // Jaro similarity
  const jaro = (matches / aLower.length + matches / bLower.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler modification: boost for common prefix
  let prefixLength = 0;
  for (let i = 0; i < Math.min(4, aLower.length, bLower.length); i++) {
    if (aLower[i] === bLower[i]) {
      prefixLength++;
    } else {
      break;
    }
  }

  return jaro + prefixLength * 0.1 * (1 - jaro);
}
