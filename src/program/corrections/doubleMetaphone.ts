/**
 * Double Metaphone Implementation
 *
 * A phonetic encoding algorithm that generates phonetic codes for English words.
 * Produces two codes: primary and secondary (for words with multiple pronunciations).
 *
 * Based on Lawrence Philips' Double Metaphone algorithm.
 */

export interface DoubleMetaphoneResult {
  primary: string;
  secondary: string | null;
}

/**
 * Generate Double Metaphone codes for a word
 */
export function doubleMetaphone(word: string): DoubleMetaphoneResult {
  if (!word || word.length === 0) {
    return { primary: '', secondary: null };
  }

  // Convert to uppercase and remove non-letters
  const input = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (input.length === 0) {
    return { primary: '', secondary: null };
  }

  let primary = '';
  let secondary = '';
  let current = 0;
  const length = input.length;
  const last = length - 1;

  // Skip silent letters at the start
  if (isAt(input, 0, 'GN', 'KN', 'PN', 'WR', 'PS')) {
    current += 1;
  }

  // Initial 'X' is pronounced 'Z' (e.g., Xavier)
  if (input[0] === 'X') {
    primary += 'S';
    secondary += 'S';
    current += 1;
  }

  while (current < length && (primary.length < 4 || secondary.length < 4)) {
    const char = input[current];

    switch (char) {
      case 'A':
      case 'E':
      case 'I':
      case 'O':
      case 'U':
      case 'Y':
        // Vowels are only encoded at the beginning
        if (current === 0) {
          primary += 'A';
          secondary += 'A';
        }
        current += 1;
        break;

      case 'B':
        primary += 'P';
        secondary += 'P';
        current += input[current + 1] === 'B' ? 2 : 1;
        break;

      case 'C':
        // Various C sounds
        if (current > 1 && !isVowel(input, current - 2) && isAt(input, current - 1, 'ACH') &&
            input[current + 2] !== 'I' && (input[current + 2] !== 'E' || isAt(input, current - 2, 'BACHER', 'MACHER'))) {
          primary += 'K';
          secondary += 'K';
          current += 2;
          break;
        }

        // Special: Caesar
        if (current === 0 && isAt(input, current, 'CAESAR')) {
          primary += 'S';
          secondary += 'S';
          current += 2;
          break;
        }

        // Italian: chianti
        if (isAt(input, current, 'CHIA')) {
          primary += 'K';
          secondary += 'K';
          current += 2;
          break;
        }

        if (isAt(input, current, 'CH')) {
          // Germanic: choir, chemistry
          if (current > 0 && isAt(input, current, 'CHAE')) {
            primary += 'K';
            secondary += 'X';
            current += 2;
            break;
          }

          // Greek: character, charisma
          if (current === 0 && (isAt(input, current + 1, 'HARAC', 'HARIS') || isAt(input, current + 1, 'HOR', 'HYM', 'HIA', 'HEM')) &&
              !isAt(input, 0, 'CHORE')) {
            primary += 'K';
            secondary += 'K';
            current += 2;
            break;
          }

          // Germanic
          if ((isAt(input, 0, 'VAN ', 'VON ') || isAt(input, 0, 'SCH')) ||
              isAt(input, current - 2, 'ORCHES', 'ARCHIT', 'ORCHID') ||
              isAt(input, current + 2, 'T', 'S') ||
              ((isAt(input, current - 1, 'A', 'O', 'U', 'E') || current === 0) &&
               isAt(input, current + 2, 'L', 'R', 'N', 'M', 'B', 'H', 'F', 'V', 'W', ' '))) {
            primary += 'K';
            secondary += 'K';
          } else {
            if (current > 0) {
              if (isAt(input, 0, 'MC')) {
                primary += 'K';
                secondary += 'K';
              } else {
                primary += 'X';
                secondary += 'K';
              }
            } else {
              primary += 'X';
              secondary += 'X';
            }
          }
          current += 2;
          break;
        }

        // CZ -> S, like Czerny
        if (isAt(input, current, 'CZ') && !isAt(input, current - 2, 'WICZ')) {
          primary += 'S';
          secondary += 'X';
          current += 2;
          break;
        }

        // CIA -> X (e.g., Socialize)
        if (isAt(input, current + 1, 'CIA')) {
          primary += 'X';
          secondary += 'X';
          current += 3;
          break;
        }

        // Double C, but not McClelland
        if (isAt(input, current, 'CC') && !(current === 1 && input[0] === 'M')) {
          // Bellucci but not Accident
          if (isAt(input, current + 2, 'I', 'E', 'H') && !isAt(input, current + 2, 'HU')) {
            if ((current === 1 && input[0] === 'A') || isAt(input, current - 1, 'UCCEE', 'UCCES')) {
              primary += 'KS';
              secondary += 'KS';
            } else {
              primary += 'X';
              secondary += 'X';
            }
            current += 3;
            break;
          } else {
            primary += 'K';
            secondary += 'K';
            current += 2;
            break;
          }
        }

        if (isAt(input, current, 'CK', 'CG', 'CQ')) {
          primary += 'K';
          secondary += 'K';
          current += 2;
          break;
        }

        if (isAt(input, current, 'CI', 'CE', 'CY')) {
          // Italian vs English
          if (isAt(input, current, 'CIO', 'CIE', 'CIA')) {
            primary += 'S';
            secondary += 'X';
          } else {
            primary += 'S';
            secondary += 'S';
          }
          current += 2;
          break;
        }

        primary += 'K';
        secondary += 'K';

        if (isAt(input, current + 1, ' C', ' Q', ' G')) {
          current += 3;
        } else if (isAt(input, current + 1, 'C', 'K', 'Q') && !isAt(input, current + 1, 'CE', 'CI')) {
          current += 2;
        } else {
          current += 1;
        }
        break;

      case 'D':
        if (isAt(input, current, 'DG')) {
          if (isAt(input, current + 2, 'I', 'E', 'Y')) {
            // edge
            primary += 'J';
            secondary += 'J';
            current += 3;
            break;
          } else {
            // Edgar
            primary += 'TK';
            secondary += 'TK';
            current += 2;
            break;
          }
        }

        if (isAt(input, current, 'DT', 'DD')) {
          primary += 'T';
          secondary += 'T';
          current += 2;
          break;
        }

        primary += 'T';
        secondary += 'T';
        current += 1;
        break;

      case 'F':
        primary += 'F';
        secondary += 'F';
        current += input[current + 1] === 'F' ? 2 : 1;
        break;

      case 'G':
        if (input[current + 1] === 'H') {
          if (current > 0 && !isVowel(input, current - 1)) {
            primary += 'K';
            secondary += 'K';
            current += 2;
            break;
          }

          if (current === 0) {
            // Ghislaine, Ghetto
            if (input[current + 2] === 'I') {
              primary += 'J';
              secondary += 'J';
            } else {
              primary += 'K';
              secondary += 'K';
            }
            current += 2;
            break;
          }

          // Parker's rule: LAUGH, COUGH, etc
          if ((current > 1 && isAt(input, current - 2, 'B', 'H', 'D')) ||
              (current > 2 && isAt(input, current - 3, 'B', 'H', 'D')) ||
              (current > 3 && isAt(input, current - 4, 'B', 'H'))) {
            current += 2;
            break;
          } else {
            // e.g., Daughter, Weight
            if (current > 2 && input[current - 1] === 'U' && isAt(input, current - 3, 'C', 'G', 'L', 'R', 'T')) {
              primary += 'F';
              secondary += 'F';
            } else if (current > 0 && input[current - 1] !== 'I') {
              primary += 'K';
              secondary += 'K';
            }
            current += 2;
            break;
          }
        }

        if (input[current + 1] === 'N') {
          if (current === 1 && isVowel(input, 0) && !isSlavoGermanic(input)) {
            primary += 'KN';
            secondary += 'N';
          } else {
            if (!isAt(input, current + 2, 'EY') && input[current + 1] !== 'Y' && !isSlavoGermanic(input)) {
              primary += 'N';
              secondary += 'KN';
            } else {
              primary += 'KN';
              secondary += 'KN';
            }
          }
          current += 2;
          break;
        }

        // GL- at start, like Tagliatti
        if (isAt(input, current + 1, 'LI') && !isSlavoGermanic(input)) {
          primary += 'KL';
          secondary += 'L';
          current += 2;
          break;
        }

        // GY- at start
        if (current === 0 && (input[current + 1] === 'Y' || isAt(input, current + 1, 'ES', 'EP', 'EB', 'EL', 'EY', 'IB', 'IL', 'IN', 'IE', 'EI', 'ER'))) {
          primary += 'K';
          secondary += 'J';
          current += 2;
          break;
        }

        // -GER-, -GY-
        if ((isAt(input, current + 1, 'ER') || input[current + 1] === 'Y') &&
            !isAt(input, 0, 'DANGER', 'RANGER', 'MANGER') &&
            !isAt(input, current - 1, 'E', 'I') && !isAt(input, current - 1, 'RGY', 'OGY')) {
          primary += 'K';
          secondary += 'J';
          current += 2;
          break;
        }

        // Italian: Biaggi
        if (isAt(input, current + 1, 'E', 'I', 'Y') || isAt(input, current - 1, 'AGGI', 'OGGI')) {
          // Germanic
          if (isAt(input, 0, 'VAN ', 'VON ') || isAt(input, 0, 'SCH') || isAt(input, current + 1, 'ET')) {
            primary += 'K';
            secondary += 'K';
          } else {
            // Italian: Gianpaolo
            if (isAt(input, current + 1, 'IER ')) {
              primary += 'J';
              secondary += 'J';
            } else {
              primary += 'J';
              secondary += 'K';
            }
          }
          current += 2;
          break;
        }

        primary += 'K';
        secondary += 'K';
        current += input[current + 1] === 'G' ? 2 : 1;
        break;

      case 'H':
        // Only encode if at beginning or preceded by vowel
        if ((current === 0 || isVowel(input, current - 1)) && isVowel(input, current + 1)) {
          primary += 'H';
          secondary += 'H';
          current += 2;
        } else {
          current += 1;
        }
        break;

      case 'J':
        // Obvious Spanish: Jose, San Jacinto
        if (isAt(input, current, 'JOSE') || isAt(input, 0, 'SAN ')) {
          if ((current === 0 && input[current + 4] === ' ') || isAt(input, 0, 'SAN ')) {
            primary += 'H';
            secondary += 'H';
          } else {
            primary += 'J';
            secondary += 'H';
          }
          current += 1;
          break;
        }

        if (current === 0 && !isAt(input, current, 'JOSE')) {
          primary += 'J';
          secondary += 'A';
        } else if (isVowel(input, current - 1) && !isSlavoGermanic(input) && (input[current + 1] === 'A' || input[current + 1] === 'O')) {
          primary += 'J';
          secondary += 'H';
        } else if (current === last) {
          primary += 'J';
          secondary += '';
        } else if (!isAt(input, current + 1, 'L', 'T', 'K', 'S', 'N', 'M', 'B', 'Z') &&
                   !isAt(input, current - 1, 'S', 'K', 'L')) {
          primary += 'J';
          secondary += 'J';
        }

        current += input[current + 1] === 'J' ? 2 : 1;
        break;

      case 'K':
        primary += 'K';
        secondary += 'K';
        current += input[current + 1] === 'K' ? 2 : 1;
        break;

      case 'L':
        if (input[current + 1] === 'L') {
          // Spanish: Cabrillo, Guillermo
          if ((current === length - 3 && isAt(input, current - 1, 'ILLO', 'ILLA', 'ALLE')) ||
              ((isAt(input, last - 1, 'AS', 'OS') || isAt(input, last, 'A', 'O')) &&
               isAt(input, current - 1, 'ALLE'))) {
            primary += 'L';
            secondary += '';
            current += 2;
            break;
          }
          current += 2;
        } else {
          current += 1;
        }
        primary += 'L';
        secondary += 'L';
        break;

      case 'M':
        primary += 'M';
        secondary += 'M';
        if ((isAt(input, current - 1, 'UMB') && (current + 1 === last || isAt(input, current + 2, 'ER'))) ||
            input[current + 1] === 'M') {
          current += 2;
        } else {
          current += 1;
        }
        break;

      case 'N':
        primary += 'N';
        secondary += 'N';
        current += input[current + 1] === 'N' ? 2 : 1;
        break;

      case 'P':
        if (input[current + 1] === 'H') {
          primary += 'F';
          secondary += 'F';
          current += 2;
          break;
        }

        // Campbell, Raspberry
        primary += 'P';
        secondary += 'P';
        current += isAt(input, current + 1, 'P', 'B') ? 2 : 1;
        break;

      case 'Q':
        primary += 'K';
        secondary += 'K';
        current += input[current + 1] === 'Q' ? 2 : 1;
        break;

      case 'R':
        // French: Rogier
        if (current === last && !isSlavoGermanic(input) &&
            isAt(input, current - 2, 'IE') && !isAt(input, current - 4, 'ME', 'MA')) {
          primary += '';
          secondary += 'R';
        } else {
          primary += 'R';
          secondary += 'R';
        }
        current += input[current + 1] === 'R' ? 2 : 1;
        break;

      case 'S':
        // Special: Sugar, Island
        if (isAt(input, current - 1, 'ISL', 'YSL')) {
          current += 1;
          break;
        }

        // Special: Sugar
        if (current === 0 && isAt(input, current, 'SUGAR')) {
          primary += 'X';
          secondary += 'S';
          current += 1;
          break;
        }

        if (isAt(input, current, 'SH')) {
          // Germanic
          if (isAt(input, current + 1, 'HEIM', 'HOEK', 'HOLM', 'HOLZ')) {
            primary += 'S';
            secondary += 'S';
          } else {
            primary += 'X';
            secondary += 'X';
          }
          current += 2;
          break;
        }

        // Italian & Armenian
        if (isAt(input, current, 'SIO', 'SIA') || isAt(input, current, 'SIAN')) {
          if (!isSlavoGermanic(input)) {
            primary += 'S';
            secondary += 'X';
          } else {
            primary += 'S';
            secondary += 'S';
          }
          current += 3;
          break;
        }

        // German & Anglicizations: Smith, Schmidt
        if ((current === 0 && isAt(input, current + 1, 'M', 'N', 'L', 'W')) || isAt(input, current + 1, 'Z')) {
          primary += 'S';
          secondary += 'X';
          current += isAt(input, current + 1, 'Z') ? 2 : 1;
          break;
        }

        if (isAt(input, current, 'SC')) {
          // Schlesinger
          if (input[current + 2] === 'H') {
            // Dutch: Schenker
            if (isAt(input, current + 3, 'OO', 'ER', 'EN', 'UY', 'ED', 'EM')) {
              // School, Schooner
              if (isAt(input, current + 3, 'ER', 'EN')) {
                primary += 'X';
                secondary += 'SK';
              } else {
                primary += 'SK';
                secondary += 'SK';
              }
              current += 3;
              break;
            } else {
              if (current === 0 && !isVowel(input, 3) && input[3] !== 'W') {
                primary += 'X';
                secondary += 'S';
              } else {
                primary += 'X';
                secondary += 'X';
              }
              current += 3;
              break;
            }
          }

          if (isAt(input, current + 2, 'I', 'E', 'Y')) {
            primary += 'S';
            secondary += 'S';
            current += 3;
            break;
          }

          primary += 'SK';
          secondary += 'SK';
          current += 3;
          break;
        }

        // French: Resnais
        if (current === last && isAt(input, current - 2, 'AI', 'OI')) {
          primary += '';
          secondary += 'S';
        } else {
          primary += 'S';
          secondary += 'S';
        }

        current += isAt(input, current + 1, 'S', 'Z') ? 2 : 1;
        break;

      case 'T':
        if (isAt(input, current, 'TION')) {
          primary += 'X';
          secondary += 'X';
          current += 3;
          break;
        }

        if (isAt(input, current, 'TIA', 'TCH')) {
          primary += 'X';
          secondary += 'X';
          current += 3;
          break;
        }

        if (isAt(input, current, 'TH') || isAt(input, current, 'TTH')) {
          // Thomas, Thames
          if (isAt(input, current + 2, 'OM', 'AM') || isAt(input, 0, 'VAN ', 'VON ') || isAt(input, 0, 'SCH')) {
            primary += 'T';
            secondary += 'T';
          } else {
            primary += '0';
            secondary += 'T';
          }
          current += 2;
          break;
        }

        primary += 'T';
        secondary += 'T';
        current += isAt(input, current + 1, 'T', 'D') ? 2 : 1;
        break;

      case 'V':
        primary += 'F';
        secondary += 'F';
        current += input[current + 1] === 'V' ? 2 : 1;
        break;

      case 'W':
        // Can also be: Wh- (Wheat)
        if (isAt(input, current, 'WR')) {
          primary += 'R';
          secondary += 'R';
          current += 2;
          break;
        }

        if (current === 0 && (isVowel(input, current + 1) || isAt(input, current, 'WH'))) {
          // Wasserman vs Welles
          if (isVowel(input, current + 1)) {
            primary += 'A';
            secondary += 'F';
          } else {
            primary += 'A';
            secondary += 'A';
          }
        }

        // Arnow
        if ((current === last && isVowel(input, current - 1)) ||
            isAt(input, current - 1, 'EWSKI', 'EWSKY', 'OWSKI', 'OWSKY') ||
            isAt(input, 0, 'SCH')) {
          primary += '';
          secondary += 'F';
          current += 1;
          break;
        }

        // Polish: Filipowicz
        if (isAt(input, current, 'WICZ', 'WITZ')) {
          primary += 'TS';
          secondary += 'FX';
          current += 4;
          break;
        }

        current += 1;
        break;

      case 'X':
        // French: Breaux
        if (!(current === last && (isAt(input, current - 3, 'IAU', 'EAU') || isAt(input, current - 2, 'AU', 'OU')))) {
          primary += 'KS';
          secondary += 'KS';
        }

        current += isAt(input, current + 1, 'C', 'X') ? 2 : 1;
        break;

      case 'Z':
        // Chinese: Zhao
        if (input[current + 1] === 'H') {
          primary += 'J';
          secondary += 'J';
          current += 2;
          break;
        } else if (isAt(input, current + 1, 'ZO', 'ZI', 'ZA') ||
                   (isSlavoGermanic(input) && current > 0 && input[current - 1] !== 'T')) {
          primary += 'S';
          secondary += 'TS';
        } else {
          primary += 'S';
          secondary += 'S';
        }

        current += input[current + 1] === 'Z' ? 2 : 1;
        break;

      default:
        current += 1;
        break;
    }
  }

  // Trim to 4 characters max
  primary = primary.slice(0, 4);
  secondary = secondary.slice(0, 4);

  return {
    primary,
    secondary: secondary !== primary && secondary.length > 0 ? secondary : null,
  };
}

/**
 * Check if two phonetic results match
 */
export function phoneticMatch(a: DoubleMetaphoneResult, b: DoubleMetaphoneResult): boolean {
  if (a.primary === b.primary) return true;
  if (a.primary === b.secondary) return true;
  if (a.secondary && a.secondary === b.primary) return true;
  if (a.secondary && b.secondary && a.secondary === b.secondary) return true;
  return false;
}

/**
 * Get phonetic similarity score (0-1)
 */
export function phoneticSimilarity(a: DoubleMetaphoneResult, b: DoubleMetaphoneResult): number {
  // Exact primary match
  if (a.primary === b.primary) return 1.0;
  // Primary matches secondary
  if (a.primary === b.secondary || (a.secondary && a.secondary === b.primary)) return 0.8;
  // Secondary matches secondary
  if (a.secondary && b.secondary && a.secondary === b.secondary) return 0.6;
  return 0;
}

// ============================================================================
// Helper Functions
// ============================================================================

function isAt(str: string, start: number, ...substrs: string[]): boolean {
  for (const substr of substrs) {
    if (str.slice(start, start + substr.length) === substr) {
      return true;
    }
  }
  return false;
}

function isVowel(str: string, pos: number): boolean {
  const char = str[pos];
  return char === 'A' || char === 'E' || char === 'I' || char === 'O' || char === 'U' || char === 'Y';
}

function isSlavoGermanic(str: string): boolean {
  return str.includes('W') || str.includes('K') || str.includes('CZ') || str.includes('WITZ');
}
