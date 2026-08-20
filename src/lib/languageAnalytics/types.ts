import type { LanguageKnowledgeState } from "../../types/languageKnowledge";

/** Bump when a metric definition changes in a way that changes its value. */
export const LANGUAGE_ANALYTICS_FORMULA_VERSION = 1 as const;
export const LANGUAGE_ANALYTICS_SCHEMA_VERSION = 1 as const;

export type AnalyticsGranularity = "hour" | "day";
export type AnalyticsEventOrigin = "user" | "system" | "backfill" | "cache-render";
export type AnalyticsStatus = "fresh" | "stale" | "pending" | "unknown" | "unavailable";
export type AnalyticsFreshness = Exclude<AnalyticsStatus, "unavailable">;

export type AnalyticsMetricId =
  | "vocabulary.known_lemmas"
  | "vocabulary.familiar_lemmas"
  | "vocabulary.learning_lemmas"
  | "vocabulary.new_lemmas"
  | "exposure.encounters"
  | "exposure.unique_lemmas"
  | "exposure.documents"
  | "lookup.count"
  | "lookup.per_1000_words"
  | "activity.reading_sessions"
  | "activity.reading_minutes"
  | "activity.reading_tokens"
  | "activity.listening_minutes"
  | "activity.listening_sentences"
  | "activity.speaking_outputs"
  | "activity.writing_outputs"
  | "state.movement_count"
  | "coverage.ratio"
  | "coverage.unknown_density"
  | "difficulty.document_average"
  | "evidence.passive_count"
  | "evidence.active_count"
  | "evidence.passive_confidence"
  | "evidence.active_confidence"
  | "srs.retention";

export type AnalyticsEventKind =
  | "lexicon.encounter"
  | "lexicon.lookup"
  | "knowledge.state-change"
  | "reader.session"
  | "listening.session"
  | "practice.evidence"
  | "coverage.snapshot"
  | "srs.review";

export type AnalyticsSourceType =
  | "reader"
  | "listening"
  | "lexicon"
  | "review"
  | "practice"
  | "coverage"
  | "srs";

export interface AnalyticsDateRange {
  /** Inclusive lower bound, in Unix milliseconds. */
  from: number;
  /** Exclusive upper bound, in Unix milliseconds. */
  to: number;
  /** IANA timezone used for aggregate buckets and display labels. */
  timeZone?: string;
}

export interface LanguageAnalyticsFilter {
  profileId: string;
  dateRange?: AnalyticsDateRange;
  documentId?: string;
  sourceType?: AnalyticsSourceType;
  languageTag?: string;
}

export interface MetricDefinition {
  id: AnalyticsMetricId;
  family: "vocabulary" | "exposure" | "lookup" | "activity" | "state" | "coverage" | "difficulty" | "evidence" | "srs";
  unit: "count" | "minutes" | "tokens" | "sentences" | "ratio" | "per_1000_words";
  numerator?: string;
  denominator?: string;
  sourceEvents: readonly AnalyticsEventKind[];
  formula: string;
  minimumSampleSize?: number;
  profileScoped: true;
  formulaVersion: typeof LANGUAGE_ANALYTICS_FORMULA_VERSION;
}

export interface MetricValue<T = number> {
  value: T | null;
  status: AnalyticsStatus;
  /** Numerator and denominator are exposed so a UI can show rate context. */
  numerator?: number;
  denominator?: number;
  freshness: AnalyticsFreshness;
  asOf?: number;
  reason?: string;
}

export interface FreshnessMetadata {
  status: AnalyticsFreshness;
  computedAt?: number;
  sourceThrough?: number;
  staleAfterMs: number;
  reason?: string;
}

export interface EventBase<K extends AnalyticsEventKind, P> {
  eventId: string;
  profileId: string;
  kind: K;
  occurredAt: number;
  origin?: AnalyticsEventOrigin;
  sourceType?: AnalyticsSourceType;
  languageTag?: string;
  documentId?: string;
  sourceId?: string;
  payload: P;
}

export interface EncounterEventPayload {
  lemmaId?: string;
  lemma?: string;
  knowledgeState?: LanguageKnowledgeState;
  tokenCount?: number;
  isUniqueLemma?: boolean;
}

export interface LookupEventPayload {
  lemmaId?: string;
  count?: number;
}

export interface StateChangeEventPayload {
  entryId: string;
  previousState: LanguageKnowledgeState;
  nextState: LanguageKnowledgeState;
}

export interface ReaderSessionEventPayload {
  sessionId: string;
  durationSeconds?: number;
  tokenCount?: number;
}

export interface ListeningSessionEventPayload {
  sessionId: string;
  durationSeconds?: number;
  sentenceCount?: number;
}

export type PracticeMode = "speaking" | "writing" | "shadowing" | "dictation";

export interface PracticeEvidenceEventPayload {
  mode: PracticeMode;
  evidence: "active" | "passive";
  attempts?: number;
  correct?: number;
  confidence?: number;
  lemmaId?: string;
}

export interface CoverageSnapshotEventPayload {
  documentId: string;
  status: "pending" | "ready" | "stale";
  analyzedTokens?: number;
  knownTokens?: number;
  unknownTokens?: number;
  coverageRatio?: number;
  difficultyScore?: number;
}

export interface SrsReviewEventPayload {
  retained: boolean;
  confidence?: number;
}

export type LanguageAnalyticsEvent =
  | EventBase<"lexicon.encounter", EncounterEventPayload>
  | EventBase<"lexicon.lookup", LookupEventPayload>
  | EventBase<"knowledge.state-change", StateChangeEventPayload>
  | EventBase<"reader.session", ReaderSessionEventPayload>
  | EventBase<"listening.session", ListeningSessionEventPayload>
  | EventBase<"practice.evidence", PracticeEvidenceEventPayload>
  | EventBase<"coverage.snapshot", CoverageSnapshotEventPayload>
  | EventBase<"srs.review", SrsReviewEventPayload>;

export interface EvidenceSummary {
  count: number;
  correct: number;
  confidenceTotal: number;
  confidenceSamples: number;
  sources: Partial<Record<PracticeMode | "reading" | "listening" | "review", number>>;
}

export interface CoverageSummary {
  analyzedTokens: number;
  knownTokens: number;
  unknownTokens: number;
  readyDocuments: number;
  pendingDocuments: number;
  staleDocuments: number;
  difficultyTotal: number;
  difficultySamples: number;
}

export interface StateMovementSummary {
  total: number;
  transitions: Record<string, number>;
}

export interface LanguageAnalyticsAggregate {
  profileId: string;
  granularity: AnalyticsGranularity;
  bucketStart: string;
  timeZone: string;
  formulaVersion: typeof LANGUAGE_ANALYTICS_FORMULA_VERSION;
  metrics: Partial<Record<AnalyticsMetricId, MetricValue>>;
  stateMovement: StateMovementSummary;
  coverage: CoverageSummary;
  evidence: {
    passive: EvidenceSummary;
    active: EvidenceSummary;
  };
  processedEventCount: number;
  firstEventAt?: number;
  lastEventAt?: number;
  freshness: FreshnessMetadata;
  retentionExpiresAt?: number;
}

export interface AnalyticsEventCursor {
  occurredAt: number;
  eventId: string;
}

export interface AnalyticsAggregateKey {
  profileId: string;
  granularity: AnalyticsGranularity;
  bucketStart: string;
}

export interface AggregationStats {
  inspected: number;
  accepted: number;
  duplicateEventIds: number;
  skippedCacheRenders: number;
  skippedOutOfScope: number;
  truncated: boolean;
}

export interface AggregationResult {
  aggregates: LanguageAnalyticsAggregate[];
  stats: AggregationStats;
  nextCursor: AnalyticsEventCursor | null;
  complete: boolean;
}

export interface BackfillRequest {
  filter: Required<Pick<LanguageAnalyticsFilter, "profileId" | "dateRange">> & Omit<LanguageAnalyticsFilter, "profileId" | "dateRange">;
  granularity?: AnalyticsGranularity;
  maxEvents?: number;
  maxBuckets?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export interface AnalyticsEventPage {
  events: LanguageAnalyticsEvent[];
  nextCursor: AnalyticsEventCursor | null;
  hasMore: boolean;
}

export interface AnalyticsEventSource {
  listEvents(input: {
    filter: LanguageAnalyticsFilter;
    cursor?: AnalyticsEventCursor | null;
    limit: number;
    signal?: AbortSignal;
  }): Promise<AnalyticsEventPage>;
}

export interface AnalyticsAggregateStore {
  replaceAggregate(aggregate: LanguageAnalyticsAggregate): Promise<void>;
  listAggregates(filter: LanguageAnalyticsFilter): Promise<LanguageAnalyticsAggregate[]>;
  getCursor(profileId: string, granularity: AnalyticsGranularity): Promise<AnalyticsEventCursor | null>;
  setCursor(profileId: string, granularity: AnalyticsGranularity, cursor: AnalyticsEventCursor): Promise<void>;
  deleteProfile(profileId: string): Promise<{ aggregates: number; cursors: number; receipts: number }>;
  recordEventReceipt?(event: LanguageAnalyticsEvent): Promise<void>;
  hasEventReceipt?(profileId: string, eventId: string): Promise<boolean>;
}

export interface LanguageAnalyticsExport {
  schemaVersion: typeof LANGUAGE_ANALYTICS_SCHEMA_VERSION;
  formulaVersion: typeof LANGUAGE_ANALYTICS_FORMULA_VERSION;
  profileId: string;
  exportedAt: number;
  filter: LanguageAnalyticsFilter;
  aggregates: LanguageAnalyticsAggregate[];
  privacy: {
    includesRawPassages: false;
    includesRawEventPayloads: false;
    includesEventReceipts: false;
  };
}

export interface LanguageAnalyticsDeleteRequest {
  profileId: string;
  reason?: "profile-deleted" | "privacy-request" | "retention";
}

export interface LanguageAnalyticsDeleteReport {
  profileId: string;
  removedAggregates: number;
  removedCursors: number;
  removedEventReceipts: number;
  retainedGenericAnalytics: true;
}
