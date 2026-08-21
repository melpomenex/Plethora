/**
 * Candidate tag retrieval and ranking (TypeScript baseline)
 */

import { normalizeForComparison, toSingularStem } from "./normalization";
import type { ScoredTerm } from "./salience";

export interface CandidateTag {
  tag: string;
  score: number;
  itemCount: number;
  matchType: string;
}

export function rankCandidateTags(
  existingTags: Array<{ name: string; itemCount?: number }>,
  title: string,
  headings: string[] = [],
  salientTerms: ScoredTerm[] = [],
  limit = 30
): CandidateTag[] {
  const lowerTitle = title.toLowerCase();
  const normTitle = normalizeForComparison(title);
  const titleStem = toSingularStem(normTitle);

  const termScores = new Map<string, number>();
  for (const st of salientTerms) {
    const norm = normalizeForComparison(st.term);
    const stem = toSingularStem(norm);
    termScores.set(norm, st.score);
    termScores.set(stem, st.score);
  }

  const candidates: CandidateTag[] = [];

  for (const item of existingTags) {
    const tag = item.name.trim();
    if (!tag) continue;

    const normTag = normalizeForComparison(tag);
    const stemTag = toSingularStem(normTag);
    const itemCount = item.itemCount || 0;

    let score = 0.0;
    let matchType = "none";

    // 1. Direct title exact or substring match
    if (normTitle === normTag || titleStem === stemTag) {
      score += 10.0;
      matchType = "title-exact";
    } else if (lowerTitle.includes(tag.toLowerCase()) || normTitle.includes(normTag)) {
      score += 7.0;
      matchType = "title-contains";
    }

    // 2. Headings match
    for (const heading of headings) {
      const normH = normalizeForComparison(heading);
      if (normH.includes(normTag) || normH.includes(stemTag)) {
        score += 4.0;
        if (matchType === "none") {
          matchType = "heading-contains";
        }
      }
    }

    // 3. Salient term match
    if (termScores.has(normTag) || termScores.has(stemTag)) {
      const termScore = termScores.get(normTag) ?? termScores.get(stemTag) ?? 0;
      score += termScore * 2.0;
      if (matchType === "none") {
        matchType = "salient-term";
      }
    } else {
      const tagWords = normTag.split(/\s+/);
      if (tagWords.length > 1) {
        let wordMatches = 0;
        for (const w of tagWords) {
          if (termScores.has(w) || termScores.has(toSingularStem(w))) {
            wordMatches++;
          }
        }
        if (wordMatches === tagWords.length) {
          score += 3.5;
          if (matchType === "none") {
            matchType = "phrase-overlap";
          }
        } else if (wordMatches > 0) {
          score += 1.0 * wordMatches;
        }
      }
    }

    // 4. Popularity tie-breaker
    if (score > 0.0) {
      const popularityBonus = Math.log1p(itemCount) * 0.2;
      score += popularityBonus;

      candidates.push({
        tag,
        score,
        itemCount,
        matchType,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}
