export type RecommendationLifecycle = "candidate" | "accepted" | "dismissed" | "snoozed" | "expired";
export type RecommendationCoverageStatus = "pending" | "fresh" | "stale" | "unavailable";

export interface RecommendationCandidate { id: string; profileId: string; sourceType: string; sourceId: string; sourceFingerprint: string; title: string; url?: string; topics: readonly string[]; coverageStatus: RecommendationCoverageStatus; coveragePercent?: number; difficultyScore?: number; qualityScore: number; freshnessScore: number; duplicateOf?: string; lifecycle: RecommendationLifecycle; snoozedUntil?: number; }
export interface RecommendationRankingVector { coverageFit: number; difficultyFit: number; interestFit: number; sourceQuality: number; freshness: number; duplicatePenalty: number; }
export interface RankedRecommendation extends RecommendationCandidate { score: number; vector: RecommendationRankingVector; explanation: readonly string[]; }
