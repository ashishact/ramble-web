/**
 * Jaro-Winkler String Similarity
 *
 * Jaro (1989) + Winkler (1990) prefix bonus.
 * Better than Levenshtein for names: weights prefix matches higher,
 * so "Pravin"/"Praveen" scores higher than "Abha"/"Asha".
 */

/**
 * Jaro-Winkler similarity between two strings (0-1).
 * Winkler prefix bonus (p=0.1) applied for up to 4 common prefix characters.
 */
export function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0
  if (!s1.length || !s2.length) return 0.0

  const a = s1.toLowerCase()
  const b = s2.toLowerCase()

  if (a === b) return 1.0

  // Jaro distance
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)

  const aMatches = new Array<boolean>(a.length).fill(false)
  const bMatches = new Array<boolean>(b.length).fill(false)

  let matches = 0
  let transpositions = 0

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow)
    const end = Math.min(b.length - 1, i + matchWindow)
    for (let j = start; j <= end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0.0

  // Count transpositions
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3

  // Winkler prefix bonus (up to 4 chars, p=0.1)
  let prefixLen = 0
  for (let i = 0; i < Math.min(4, Math.min(a.length, b.length)); i++) {
    if (a[i] === b[i]) prefixLen++
    else break
  }

  return jaro + prefixLen * 0.1 * (1 - jaro)
}
