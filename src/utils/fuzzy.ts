/**
 * Fuzzy string matching shared by content search and the command registry.
 *
 * Lives in a leaf module (no React, no component imports) so the command
 * registry can use it without importing `SearchUtils` → `GlobalSearch`.
 */

/**
 * Fuzzy match using Levenshtein distance.
 */
export function fuzzyMatch(
  text: string,
  pattern: string,
  maxDistance: number = 2
): { match: boolean; score: number } {
  const textLower = text.toLowerCase();
  const patternLower = pattern.toLowerCase();

  if (patternLower === textLower) {
    return { match: true, score: 1.0 };
  }

  if (patternLower.length === 0) {
    return { match: false, score: 0 };
  }

  const distance = levenshteinDistance(textLower, patternLower);
  const maxLen = Math.max(textLower.length, patternLower.length);
  const normalizedDistance = distance / maxLen;

  return {
    match: distance <= maxDistance,
    score: 1 - normalizedDistance,
  };
}

/**
 * Calculate Levenshtein distance.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
