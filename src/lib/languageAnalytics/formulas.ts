import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import { metricValue } from "./freshness";
import type {
  AnalyticsEventKind,
  AnalyticsFreshness,
  AnalyticsMetricId,
  CoverageSummary,
  EvidenceSummary,
  MetricValue,
  StateMovementSummary,
} from "./types";

export const VOCABULARY_STATES: readonly LanguageKnowledgeState[] = ["new", "encountered", "learning", "familiar", "known"];

export interface MetricFormulaInput {
  observedEventKinds: ReadonlySet<AnalyticsEventKind>;
  lemmaStates: ReadonlyMap<string, LanguageKnowledgeState>;
  encounters: number;
  uniqueLemmaIds: ReadonlySet<string>;
  documentIds: ReadonlySet<string>;
  lookups: number;
  readingSessions: number;
  readingSeconds: number;
  readingTokens: number;
  listeningSeconds: number;
  listeningSentences: number;
  speakingOutputs: number;
  writingOutputs: number;
  stateMovement: StateMovementSummary;
  coverage: CoverageSummary;
  passiveEvidence: EvidenceSummary;
  activeEvidence: EvidenceSummary;
  srsReviews: number;
  srsRetained: number;
  speakingAvailable?: boolean;
  writingAvailable?: boolean;
  freshness: AnalyticsFreshness;
  asOf?: number;
}

export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function lookupsPerThousandWords(lookups: number, words: number): number | null {
  const ratio = safeRatio(lookups, words);
  return ratio === null ? null : ratio * 1000;
}

export function countVocabularyStates(states: ReadonlyMap<string, LanguageKnowledgeState>): Record<string, number> {
  const counts: Record<string, number> = { known: 0, familiar: 0, learning: 0, new: 0 };
  for (const state of states.values()) {
    if (state === "known") counts.known += 1;
    else if (state === "familiar") counts.familiar += 1;
    else if (state === "learning") counts.learning += 1;
    else if (state === "new" || state === "encountered") counts.new += 1;
  }
  return counts;
}

export function coverageRatio(coverage: Pick<CoverageSummary, "knownTokens" | "analyzedTokens">): number | null {
  return safeRatio(coverage.knownTokens, coverage.analyzedTokens);
}

export function unknownDensity(coverage: Pick<CoverageSummary, "unknownTokens" | "analyzedTokens">): number | null {
  return safeRatio(coverage.unknownTokens, coverage.analyzedTokens);
}

export function documentDifficulty(coverage: Pick<CoverageSummary, "difficultyTotal" | "difficultySamples">): number | null {
  return safeRatio(coverage.difficultyTotal, coverage.difficultySamples);
}

export function averageEvidenceConfidence(evidence: Pick<EvidenceSummary, "confidenceTotal" | "confidenceSamples">): number | null {
  return safeRatio(evidence.confidenceTotal, evidence.confidenceSamples);
}

function observed(input: MetricFormulaInput, ...kinds: AnalyticsEventKind[]): boolean {
  return kinds.some((kind) => input.observedEventKinds.has(kind));
}

function countMetric(input: MetricFormulaInput, id: AnalyticsMetricId, value: number, sourceKinds: AnalyticsEventKind[], capability = true): MetricValue {
  return metricValue(value, {
    freshness: input.freshness,
    measured: observed(input, ...sourceKinds),
    capability,
    asOf: input.asOf,
  });
}

function ratioMetric(
  input: MetricFormulaInput,
  numerator: number,
  denominator: number,
  value: number | null,
  sourceKinds: AnalyticsEventKind[],
  reason = "denominator_unavailable",
): MetricValue {
  return metricValue(value, {
    freshness: input.freshness,
    measured: observed(input, ...sourceKinds) && value !== null,
    numerator,
    denominator,
    asOf: input.asOf,
    reason,
  });
}

export function computeLanguageMetrics(input: MetricFormulaInput): Partial<Record<AnalyticsMetricId, MetricValue>> {
  const states = countVocabularyStates(input.lemmaStates);
  const passiveConfidence = averageEvidenceConfidence(input.passiveEvidence);
  const activeConfidence = averageEvidenceConfidence(input.activeEvidence);
  const coverageFreshness: AnalyticsFreshness =
    input.coverage.pendingDocuments > 0 ? "pending" : input.coverage.staleDocuments > 0 ? "stale" : input.freshness;

  const metrics: Partial<Record<AnalyticsMetricId, MetricValue>> = {
    "vocabulary.known_lemmas": countMetric(input, "vocabulary.known_lemmas", states.known, ["lexicon.encounter", "knowledge.state-change"]),
    "vocabulary.familiar_lemmas": countMetric(input, "vocabulary.familiar_lemmas", states.familiar, ["lexicon.encounter", "knowledge.state-change"]),
    "vocabulary.learning_lemmas": countMetric(input, "vocabulary.learning_lemmas", states.learning, ["lexicon.encounter", "knowledge.state-change"]),
    "vocabulary.new_lemmas": countMetric(input, "vocabulary.new_lemmas", states.new, ["lexicon.encounter", "knowledge.state-change"]),
    "exposure.encounters": countMetric(input, "exposure.encounters", input.encounters, ["lexicon.encounter"]),
    "exposure.unique_lemmas": countMetric(input, "exposure.unique_lemmas", input.uniqueLemmaIds.size, ["lexicon.encounter", "knowledge.state-change"]),
    "exposure.documents": countMetric(input, "exposure.documents", input.documentIds.size, ["lexicon.encounter", "reader.session", "listening.session", "coverage.snapshot"]),
    "lookup.count": countMetric(input, "lookup.count", input.lookups, ["lexicon.lookup"]),
    "lookup.per_1000_words": ratioMetric(input, input.lookups, input.readingTokens, lookupsPerThousandWords(input.lookups, input.readingTokens), ["lexicon.lookup", "reader.session"]),
    "activity.reading_sessions": countMetric(input, "activity.reading_sessions", input.readingSessions, ["reader.session"]),
    "activity.reading_minutes": countMetric(input, "activity.reading_minutes", input.readingSeconds / 60, ["reader.session"]),
    "activity.reading_tokens": countMetric(input, "activity.reading_tokens", input.readingTokens, ["reader.session"]),
    "activity.listening_minutes": countMetric(input, "activity.listening_minutes", input.listeningSeconds / 60, ["listening.session"]),
    "activity.listening_sentences": countMetric(input, "activity.listening_sentences", input.listeningSentences, ["listening.session"]),
    "activity.speaking_outputs": countMetric(input, "activity.speaking_outputs", input.speakingOutputs, ["practice.evidence"], input.speakingAvailable ?? false),
    "activity.writing_outputs": countMetric(input, "activity.writing_outputs", input.writingOutputs, ["practice.evidence"], input.writingAvailable ?? false),
    "state.movement_count": countMetric(input, "state.movement_count", input.stateMovement.total, ["knowledge.state-change"]),
    "coverage.ratio": metricValue(coverageRatio(input.coverage), {
      freshness: coverageFreshness,
      measured: observed(input, "coverage.snapshot") && coverageRatio(input.coverage) !== null,
      numerator: input.coverage.knownTokens,
      denominator: input.coverage.analyzedTokens,
      asOf: input.asOf,
    }),
    "coverage.unknown_density": metricValue(unknownDensity(input.coverage), {
      freshness: coverageFreshness,
      measured: observed(input, "coverage.snapshot") && unknownDensity(input.coverage) !== null,
      numerator: input.coverage.unknownTokens,
      denominator: input.coverage.analyzedTokens,
      asOf: input.asOf,
    }),
    "difficulty.document_average": metricValue(documentDifficulty(input.coverage), {
      freshness: coverageFreshness,
      measured: observed(input, "coverage.snapshot") && documentDifficulty(input.coverage) !== null,
      numerator: input.coverage.difficultyTotal,
      denominator: input.coverage.difficultySamples,
      asOf: input.asOf,
    }),
    "evidence.passive_count": countMetric(input, "evidence.passive_count", input.passiveEvidence.count, ["lexicon.encounter", "practice.evidence"]),
    "evidence.active_count": countMetric(input, "evidence.active_count", input.activeEvidence.count, ["practice.evidence", "srs.review"]),
    "evidence.passive_confidence": ratioMetric(input, input.passiveEvidence.confidenceTotal, input.passiveEvidence.confidenceSamples, passiveConfidence, ["lexicon.encounter", "practice.evidence"]),
    "evidence.active_confidence": ratioMetric(input, input.activeEvidence.confidenceTotal, input.activeEvidence.confidenceSamples, activeConfidence, ["practice.evidence", "srs.review"]),
    "srs.retention": ratioMetric(input, input.srsRetained, input.srsReviews, safeRatio(input.srsRetained, input.srsReviews), ["srs.review"]),
  };

  return metrics;
}
