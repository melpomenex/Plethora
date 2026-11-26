import type {
  RankedRecommendation,
  RecommendationCandidate,
  RecommendationLifecycle,
  RecommendationRankingOptions,
  RecommendationRankingVector,
} from "./types";

const DEFAULT_TARGET_COVERAGE_MIN = 90;
const DEFAULT_TARGET_COVERAGE_MAX = 98;
const RANKABLE_LIFECYCLES = new Set<RecommendationLifecycle>([
  "candidate",
  "analyzed",
  "recommended",
]);

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function isCandidateActive(candidate: RecommendationCandidate, now: number): boolean {
  if (candidate.snoozedUntil !== undefined && candidate.snoozedUntil > now) {
    return false;
  }
  if (RANKABLE_LIFECYCLES.has(candidate.lifecycle)) {
    return true;
  }
  return (
    candidate.lifecycle === "snoozed" &&
    candidate.snoozedUntil !== undefined &&
    candidate.snoozedUntil <= now
  );
}

function evaluateCoverage(
  candidate: RecommendationCandidate,
  targetMin: number,
  targetMax: number,
): { coverageFit: number; explanations: string[] } {
  if (
    candidate.coverageStatus !== "fresh" ||
    candidate.coveragePercent === undefined ||
    !Number.isFinite(candidate.coveragePercent)
  ) {
    return {
      coverageFit: 0,
      explanations: ["Coverage pending analysis"],
    };
  }

  const coveragePercent = Math.max(0, Math.min(100, candidate.coveragePercent));
  const rounded = Math.round(coveragePercent);

  if (coveragePercent >= targetMin && coveragePercent <= targetMax) {
    return {
      coverageFit: 1.0,
      explanations: [
        `Approximately ${rounded}% of measured vocabulary is familiar (in your target range)`,
        "uses measured coverage",
      ],
    };
  }

  if (coveragePercent < targetMin) {
    const gap = targetMin - coveragePercent;
    const coverageFit = clamp(1 - gap / 30);
    const descriptor =
      gap > 15
        ? "much harder than preferred"
        : "slightly above your preferred difficulty";
    return {
      coverageFit,
      explanations: [
        `Approximately ${rounded}% familiar — ${descriptor}`,
        "uses measured coverage",
      ],
    };
  }

  const surplus = coveragePercent - targetMax;
  return {
    coverageFit: clamp(1 - surplus / 20),
    explanations: [
      `Approximately ${rounded}% familiar — comfortable reading`,
      "uses measured coverage",
    ],
  };
}

export function rankLanguageRecommendations(
  candidates: readonly RecommendationCandidate[],
  interests: readonly string[],
  nowOrOptions: number | (RecommendationRankingOptions & { now?: number }) = Date.now(),
  maybeOptions: RecommendationRankingOptions = {},
): RankedRecommendation[] {
  const now =
    typeof nowOrOptions === "number" ? nowOrOptions : (nowOrOptions.now ?? Date.now());
  const options = typeof nowOrOptions === "number" ? maybeOptions : nowOrOptions;

  const rawMin = options.targetCoverageMin ?? DEFAULT_TARGET_COVERAGE_MIN;
  const rawMax = options.targetCoverageMax ?? DEFAULT_TARGET_COVERAGE_MAX;
  const targetMin = Math.min(rawMin, rawMax);
  const targetMax = Math.max(rawMin, rawMax);

  const interestSet = new Set(interests.map((interest) => interest.toLocaleLowerCase()));

  return candidates
    .filter((candidate) => isCandidateActive(candidate, now))
    .map((candidate) => {
      const matchedTopics = candidate.topics.filter((topic) =>
        interestSet.has(topic.toLocaleLowerCase()),
      );
      const interestFit = clamp(matchedTopics.length / Math.max(1, candidate.topics.length));
      const { coverageFit, explanations: coverageExplanations } = evaluateCoverage(
        candidate,
        targetMin,
        targetMax,
      );
      const difficultyFit =
        candidate.difficultyScore === undefined
          ? 0
          : clamp(1 - Math.abs(candidate.difficultyScore - 30) / 50);

      const vector: RecommendationRankingVector = {
        coverageFit,
        difficultyFit,
        interestFit,
        sourceQuality: clamp(candidate.qualityScore),
        freshness: clamp(candidate.freshnessScore),
        duplicatePenalty: candidate.duplicateOf ? 1 : 0,
      };

      const score =
        vector.coverageFit * 0.35 +
        vector.interestFit * 0.25 +
        vector.difficultyFit * 0.15 +
        vector.sourceQuality * 0.15 +
        vector.freshness * 0.1 -
        vector.duplicatePenalty * 0.5;

      const explanation: string[] = [];
      if (matchedTopics.length > 0) {
        explanation.push(`Matches your interest in ${matchedTopics.join(", ")}`);
      } else {
        explanation.push("outside current interests");
      }
      explanation.push(...coverageExplanations);

      if ((candidate.reinforcingLearningCount ?? 0) > 0) {
        const count = candidate.reinforcingLearningCount!;
        explanation.push(
          `Reinforces ${count} ${count === 1 ? "word" : "words"} you are currently learning`,
        );
      }

      if ((candidate.recentEncounterCount ?? 0) > 0) {
        const count = candidate.recentEncounterCount!;
        explanation.push(
          `Contains ${count} ${count === 1 ? "word" : "words"} from recent encounters`,
        );
      }

      explanation.push(candidate.duplicateOf ? "duplicate suppressed" : "new source");

      return { ...candidate, score, vector, explanation };
    })
    .filter((candidate) => !candidate.duplicateOf)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}
