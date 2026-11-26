export type RecommendationLifecycle =
  | "discovered"
  | "pending_retrieval"
  | "pending_analysis"
  | "analyzed"
  | "recommended"
  | "candidate"
  | "accepted"
  | "imported"
  | "dismissed"
  | "snoozed"
  | "expired"
  | "failed"
  | "unavailable";

export type RecommendationCoverageStatus = "pending" | "fresh" | "stale" | "unavailable";

export interface RecommendationCandidate {
  id: string;
  profileId: string;
  sourceType: string;
  sourceId: string;
  sourceFingerprint: string;
  title: string;
  url?: string;
  languageTag?: string;
  topics: readonly string[];
  coverageStatus: RecommendationCoverageStatus;
  coveragePercent?: number;
  difficultyScore?: number;
  reinforcingLearningCount?: number;
  recentEncounterCount?: number;
  qualityScore: number;
  freshnessScore: number;
  duplicateOf?: string;
  lifecycle: RecommendationLifecycle;
  snoozedUntil?: number;
  importedDocumentId?: string;
  summary?: string;
  author?: string;
  durationSeconds?: number;
  wordCount?: number;
  publishedAt?: number;
}

export interface RecommendationRankingOptions {
  targetCoverageMin?: number;
  targetCoverageMax?: number;
}

export interface RecommendationRankingVector {
  coverageFit: number;
  difficultyFit: number;
  interestFit: number;
  sourceQuality: number;
  freshness: number;
  duplicatePenalty: number;
}

export interface RankedRecommendation extends RecommendationCandidate {
  score: number;
  vector: RecommendationRankingVector;
  explanation: readonly string[];
}
