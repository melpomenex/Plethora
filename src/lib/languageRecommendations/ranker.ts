import type { RankedRecommendation, RecommendationCandidate, RecommendationRankingVector } from "./types";

function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

export function rankLanguageRecommendations(candidates: readonly RecommendationCandidate[], interests: readonly string[], now = Date.now()): RankedRecommendation[] {
  const interestSet = new Set(interests.map((interest) => interest.toLocaleLowerCase()));
  return candidates
    .filter((candidate) => candidate.lifecycle === "candidate" && (candidate.snoozedUntil === undefined || candidate.snoozedUntil <= now))
    .map((candidate) => {
      const interestFit = clamp(candidate.topics.filter((topic) => interestSet.has(topic.toLocaleLowerCase())).length / Math.max(1, candidate.topics.length));
      const coverageFit = candidate.coverageStatus === "fresh" && candidate.coveragePercent !== undefined ? clamp(1 - candidate.coveragePercent / 100) : 0;
      const difficultyFit = candidate.difficultyScore === undefined ? 0 : clamp(1 - Math.abs(candidate.difficultyScore - 50) / 50);
      const vector: RecommendationRankingVector = { coverageFit, difficultyFit, interestFit, sourceQuality: clamp(candidate.qualityScore), freshness: clamp(candidate.freshnessScore), duplicatePenalty: candidate.duplicateOf ? 1 : 0 };
      const score = vector.interestFit * 0.3 + vector.coverageFit * 0.25 + vector.difficultyFit * 0.15 + vector.sourceQuality * 0.15 + vector.freshness * 0.15 - vector.duplicatePenalty * 0.5;
      const explanation = [interestFit > 0 ? "matches your interests" : "outside current interests", candidate.coverageStatus === "fresh" ? "uses measured coverage" : "coverage is pending or unavailable", candidate.duplicateOf ? "duplicate suppressed" : "new source"];
      return { ...candidate, score, vector, explanation };
    })
    .filter((candidate) => !candidate.duplicateOf)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
