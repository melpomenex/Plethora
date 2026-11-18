import type { Theme } from "../../types/theme";
import { fuzzyMatch } from "../../utils/fuzzy";

const WORD_SEPARATORS = /[\s\-_—–/]+/;

/**
 * Scores a subsequence match (e.g. "dog" -> "Deep Ocean Glow") in `0..180`,
 * or returns `null` if `pattern` is not a subsequence of `text`.
 */
function subsequenceScore(text: string, pattern: string): number | null {
  if (!pattern) return null;

  let pIdx = 0;
  let score = 0;
  let consecutive = 0;

  for (let i = 0; i < text.length && pIdx < pattern.length; i++) {
    if (text[i] === pattern[pIdx]) {
      const isBoundary = i === 0 || WORD_SEPARATORS.test(text[i - 1]);
      score += 10;
      if (isBoundary) score += 18;
      if (consecutive > 0) score += 12;
      consecutive++;
      pIdx++;
    } else {
      consecutive = 0;
    }
  }

  if (pIdx < pattern.length) return null;

  // Favor tighter matches relative to theme name length.
  const compactness = Math.max(0, 40 - Math.max(0, text.length - pattern.length));
  return Math.min(180, score + compactness);
}

function scoreTokenAgainstTheme(theme: Theme, token: string): number {
  const nameLower = theme.name.toLowerCase();
  const idLower = theme.id.toLowerCase();
  const descLower = theme.description?.toLowerCase() ?? "";
  const variantLower = theme.variant.toLowerCase();
  const animationLower = theme.effects?.backgroundAnimation?.toLowerCase() ?? "";
  const isAnimated = Boolean(theme.effects?.backgroundAnimation);

  if (nameLower === token || idLower === token) return 1000;
  if (nameLower.startsWith(token) || idLower.startsWith(token)) return 850;

  const words = Array.from(
    new Set([
      ...nameLower.split(WORD_SEPARATORS).filter(Boolean),
      ...idLower.split(WORD_SEPARATORS).filter(Boolean),
    ]),
  );

  if (words.some((w) => w.startsWith(token))) return 750;
  if (nameLower.includes(token) || idLower.includes(token)) return 650;

  const subName = subsequenceScore(nameLower, token);
  const subId = subsequenceScore(idLower, token);
  const bestSub = Math.max(subName ?? -1, subId ?? -1);
  if (bestSub >= 0) return 400 + bestSub;

  const maxDistance = token.length <= 2 ? 0 : token.length <= 5 ? 1 : 2;
  if (maxDistance > 0) {
    let bestFuzzy = 0;
    for (const word of words) {
      if (Math.abs(word.length - token.length) > maxDistance) continue;
      const res = fuzzyMatch(word, token, maxDistance);
      if (res.match && res.score > bestFuzzy) {
        bestFuzzy = res.score;
      }
    }
    if (bestFuzzy > 0) {
      return 300 + Math.round(bestFuzzy * 150);
    }
  }

  if (variantLower === token || variantLower.startsWith(token)) return 250;
  if ((isAnimated && "animated".startsWith(token)) || (animationLower && animationLower.includes(token))) {
    return 240;
  }
  if (descLower.includes(token)) return 200;

  return 0;
}

/**
 * Scores a theme against a search query. Returns `0` when the theme does not match.
 */
export function scoreThemeMatch(theme: Theme, query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  let total = 0;
  for (const token of tokens) {
    const tokenScore = scoreTokenAgainstTheme(theme, token);
    if (tokenScore === 0) return 0;
    total += tokenScore;
  }

  const nameLower = theme.name.toLowerCase();
  if (nameLower.startsWith(normalized)) {
    total += 200;
  } else if (nameLower.includes(normalized)) {
    total += 100;
  }

  return total;
}

/**
 * Filters and ranks themes by fuzzy match score (highest first).
 * When `query` is empty/whitespace, returns `themes` unchanged.
 */
export function filterAndRankThemes(themes: Theme[], query: string): Theme[] {
  const normalized = query.trim();
  if (!normalized) return themes;

  const scored: Array<{ theme: Theme; score: number; index: number }> = [];
  for (let i = 0; i < themes.length; i++) {
    const theme = themes[i];
    const score = scoreThemeMatch(theme, normalized);
    if (score > 0) {
      scored.push({ theme, score, index: i });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return scored.map((entry) => entry.theme);
}
