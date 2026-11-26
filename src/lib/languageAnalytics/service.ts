import {
  getLanguageCoverageResults,
  listLanguageAnalyticsDaily,
  recordLanguageAnalyticsEvent,
  type LanguageAnalyticsDailyRecord,
  type LanguageCoverageResultRecord,
} from "../../api/languageEcosystem";
import { exportLanguageKnowledge, listLanguageKnowledgeStates } from "../../api/languageKnowledge";
import { listLanguageLexicalEntries, listLanguageLookupEvents } from "../../api/languageLexicon";
import { listLanguagePracticeAttempts } from "../../api/languagePractice";
import type {
  LanguageKnowledgeEvidenceEvent,
  LanguageKnowledgeExport,
  LanguageKnowledgeState,
  LanguageKnowledgeStateHistory,
  LanguageKnowledgeStateSnapshot,
} from "../../types/languageKnowledge";
import type { LanguageLexicalEntry, LanguageLookupEvent, LexiconPage } from "../../types/languageLexicon";
import type {
  ComparisonErrorKind,
  PracticeAttempt,
  PracticeMode as PracticeAttemptMode,
} from "../languagePractice/types";
import {
  analyticsBucketStart,
  DEFAULT_ANALYTICS_TIME_ZONE,
  eventMatchesFilter,
  normalizeAnalyticsFilter,
  normalizeDateRange,
} from "./filters";
import { computeLanguageMetrics, type MetricFormulaInput } from "./formulas";
import { deriveFreshness } from "./freshness";
import type {
  AnalyticsDateRange,
  AnalyticsEventKind,
  AnalyticsEventOrigin,
  AnalyticsMetricId,
  AnalyticsSourceType,
  CoverageSummary,
  EvidenceSummary,
  FreshnessMetadata,
  LanguageAnalyticsEvent,
  MetricValue,
  StateMovementSummary,
} from "./types";

const MILLISECONDS_THRESHOLD = 10_000_000_000;
const DAY_MS = 86_400_000;
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 50;

const STATE_RANK: Record<LanguageKnowledgeState, number> = {
  ignored: 0,
  new: 1,
  encountered: 2,
  learning: 3,
  familiar: 4,
  known: 5,
};

const VALID_KNOWLEDGE_STATES = new Set<LanguageKnowledgeState>([
  "new",
  "encountered",
  "learning",
  "familiar",
  "known",
  "ignored",
]);

const PRACTICE_ATTEMPT_MODES: readonly PracticeAttemptMode[] = [
  "dictation",
  "writing",
  "pronunciation",
  "shadowing",
];

const ERROR_CATEGORIES: readonly ComparisonErrorKind[] = [
  "missing",
  "extra",
  "substitution",
  "punctuation",
  "diacritic",
  "order",
  "script",
];

export type EvidenceAvailabilityStatus =
  | "ready"
  | "stale"
  | "pending"
  | "insufficient-evidence"
  | "unavailable";

export interface VocabStateCounts {
  known: number;
  familiar: number;
  learning: number;
  new: number;
  encountered: number;
  ignored: number;
  totalActive: number;
  total: number;
}

export interface VocabGrowthDayPoint {
  dayUtc: string;
  encounters: number;
  lookups: number;
  stateChanges: number;
  newLemmas: number;
  newExactForms: number;
  knownTransitions: number;
  cumulativeKnownLemmas: number;
  readingSessions: number;
  listeningSessions: number;
  practiceEvents: number;
  srsReviews: number;
  totalEvents: number;
}

export interface PracticeModeBreakdown {
  mode: PracticeAttemptMode;
  status: EvidenceAvailabilityStatus;
  attempts: number;
  submitted: number;
  acceptedActive: number;
  exactCount: number;
  uncertainCount: number;
  assistedCount: number;
  averageScore: number | null;
  totalErrors: number;
  errorsByCategory: Record<ComparisonErrorKind, number>;
  reason?: string;
}

export interface CoverageProgressionPoint {
  coverageKey: string;
  documentId: string;
  computedAt: number;
  dayUtc: string;
  freshness: LanguageCoverageResultRecord["freshness"];
  analyzedTokens: number;
  knownTokens: number;
  unknownTokens: number;
  coverageRatio: number | null;
  knownCoverageRatio: number | null;
  unknownDensity: number | null;
  difficultyScore: number | null;
  difficultyBand?: string;
  difficultyLabel?: string;
}

export interface RepeatedLookupItem {
  entryId: string;
  lemma?: string;
  normalizedForm: string;
  canonicalForm: string;
  lookupCount: number;
  encounterCount: number;
  knowledgeState: LanguageKnowledgeState;
}

export interface LanguageAnalyticsDashboardData {
  profileId: string;
  range: Required<AnalyticsDateRange>;
  generatedAt: number;
  freshness: FreshnessMetadata;
  metrics: Partial<Record<AnalyticsMetricId, MetricValue>>;
  vocabulary: {
    status: EvidenceAvailabilityStatus;
    lemmas: VocabStateCounts;
    exactForms: VocabStateCounts;
    activeInRange: {
      lemmas: VocabStateCounts;
      exactForms: VocabStateCounts;
    };
    stateMovementsInRange: StateMovementSummary;
    reason?: string;
  };
  vocabGrowthByDay: VocabGrowthDayPoint[];
  evidence: {
    status: EvidenceAvailabilityStatus;
    passive: EvidenceSummary & {
      averageConfidence: number | null;
      status: EvidenceAvailabilityStatus;
      reason?: string;
    };
    active: EvidenceSummary & {
      averageConfidence: number | null;
      status: EvidenceAvailabilityStatus;
      reason?: string;
    };
    srs: {
      reviews: number;
      retained: number;
      retentionRate: number | null;
      status: EvidenceAvailabilityStatus;
      reason?: string;
    };
    reason?: string;
  };
  lookups: {
    status: EvidenceAvailabilityStatus;
    totalLookupsInRange: number;
    lookupsPer1000Words: number | null;
    uniqueEntriesLookedUp: number;
    repeatedLookupEntries: number;
    repetitionRate: number | null;
    totalEncounters: number;
    averageEncountersPerLemma: number | null;
    topRepeatedLookups: RepeatedLookupItem[];
    reason?: string;
  };
  activity: {
    reading: {
      status: EvidenceAvailabilityStatus;
      sessions: number;
      minutes: number | null;
      tokens: number | null;
      reason?: string;
    };
    listening: {
      status: EvidenceAvailabilityStatus;
      sessions: number;
      minutes: number | null;
      sentences: number | null;
      reason?: string;
    };
    practice: {
      status: EvidenceAvailabilityStatus;
      totalAttempts: number;
      submittedAttempts: number;
      acceptedActiveAttempts: number;
      averageScore: number | null;
      totalErrors: number;
      errorsByCategory: Record<ComparisonErrorKind, number>;
      byMode: Record<PracticeAttemptMode, PracticeModeBreakdown>;
      reason?: string;
    };
  };
  coverage: {
    status: EvidenceAvailabilityStatus;
    summary: CoverageSummary;
    averageCoverageRatio: number | null;
    averageUnknownDensity: number | null;
    averageDifficultyScore: number | null;
    readyDocuments: number;
    pendingDocuments: number;
    staleDocuments: number;
    unavailableOrFailedDocuments: number;
    progression: CoverageProgressionPoint[];
    reason?: string;
  };
  /** Never synthesize or certify CEFR/proficiency numbers without an explicit calibrated assessment. */
  proficiency: {
    status: "unavailable";
    cefrLevel: null;
    proficiencyScore: null;
    reason: "cefr_certification_not_measured";
  };
}

export interface LanguageAnalyticsLoaders {
  listDaily?: (
    profileId: string,
    options?: { startDay?: string; endDay?: string },
  ) => Promise<LanguageAnalyticsDailyRecord[]>;
  exportKnowledge?: (profileId: string) => Promise<LanguageKnowledgeExport>;
  listKnowledgeStates?: (
    profileId: string,
    options?: { offset?: number; limit?: number },
  ) => Promise<LexiconPage<LanguageKnowledgeStateSnapshot>>;
  listLexicalEntries?: (
    profileId: string,
    options?: { languageTag?: string; offset?: number; limit?: number },
  ) => Promise<LexiconPage<LanguageLexicalEntry>>;
  listLookupEvents?: (
    profileId: string,
    options?: { offset?: number; limit?: number },
  ) => Promise<LexiconPage<LanguageLookupEvent>>;
  listPracticeAttempts?: (
    profileId: string,
    options?: { offset?: number; limit?: number },
  ) => Promise<PracticeAttempt[]>;
  getCoverageResults?: (profileId: string) => Promise<LanguageCoverageResultRecord[]>;
}

export interface LoadLanguageAnalyticsOptions {
  languageTag?: string;
  documentId?: string;
  sourceType?: AnalyticsSourceType;
  now?: number;
  staleAfterMs?: number;
  minimumSampleSize?: number;
  speakingAvailable?: boolean;
  writingAvailable?: boolean;
  pageSize?: number;
  maxPages?: number;
  loaders?: LanguageAnalyticsLoaders;
}

export interface EmitLanguageAnalyticsEventInput {
  profileId: string;
  eventKind: AnalyticsEventKind | (string & {});
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  occurredAt?: number;
  origin?: AnalyticsEventOrigin;
  isRerender?: boolean;
  isCacheHit?: boolean;
  isReopenedDocument?: boolean;
  recordEvent?: typeof recordLanguageAnalyticsEvent;
}

export function toUnixSeconds(timestamp: number): number {
  if (!Number.isFinite(timestamp)) return Math.floor(Date.now() / 1000);
  return timestamp > MILLISECONDS_THRESHOLD ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}

export function toUnixMillis(timestamp: number): number {
  if (!Number.isFinite(timestamp)) return 0;
  return timestamp > 0 && timestamp < MILLISECONDS_THRESHOLD ? timestamp * 1000 : timestamp;
}

function toDayUtc(timestamp: number): string {
  return new Date(toUnixMillis(timestamp)).toISOString().slice(0, 10);
}

function utcDayToBoundsMs(dayUtc: string): { start: number; end: number } | null {
  const start = Date.parse(`${dayUtc}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + DAY_MS };
}

function normalizePart(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : fallback;
}

/** Deterministic idempotency key for a lexical encounter (stable across document reopens and UI re-renders). */
export function buildEncounterIdempotencyKey(input: {
  profileId: string;
  occurrenceKey?: string;
  processingKey?: string;
  documentId?: string;
  sourceId?: string;
  contentFingerprint?: string;
  sentenceId?: string;
  tokenId?: string;
  entryId?: string;
  surface?: string;
}): string {
  if (input.occurrenceKey?.trim()) {
    return `encounter:${input.profileId}:${input.occurrenceKey.trim()}`;
  }
  const source = normalizePart(input.documentId ?? input.sourceId, "no-source");
  const fp = normalizePart(input.contentFingerprint ?? input.processingKey, "no-fp");
  const sentence = normalizePart(input.sentenceId, "no-sentence");
  const token = normalizePart(input.tokenId ?? input.entryId ?? input.surface, "no-token");
  return `encounter:${input.profileId}:${source}:${fp}:${sentence}:${token}`;
}

/** Deterministic idempotency key for an explicit dictionary/lexicon lookup action. */
export function buildLookupIdempotencyKey(input: {
  profileId: string;
  lookupId?: string;
  actionId?: string;
  documentId?: string;
  mediaId?: string;
  sentenceId?: string;
  tokenId?: string;
  entryId?: string;
  surface?: string;
  occurredAt?: number;
}): string {
  if (input.lookupId?.trim()) return `lookup:${input.profileId}:${input.lookupId.trim()}`;
  if (input.actionId?.trim()) return `lookup:${input.profileId}:${input.actionId.trim()}`;
  const source = normalizePart(input.documentId ?? input.mediaId, "no-source");
  const locator = normalizePart(input.sentenceId ?? input.tokenId, "no-locator");
  const target = normalizePart(input.entryId ?? input.surface, "no-target");
  const at = input.occurredAt !== undefined ? String(toUnixSeconds(input.occurredAt)) : "single";
  return `lookup:${input.profileId}:${source}:${locator}:${target}:${at}`;
}

/** Deterministic idempotency key for an explicit knowledge state transition. */
export function buildStateChangeIdempotencyKey(input: {
  profileId: string;
  operationId?: string;
  historyId?: string;
  entryId: string;
  previousState: LanguageKnowledgeState;
  nextState: LanguageKnowledgeState;
  occurredAt?: number;
}): string {
  if (input.operationId?.trim()) return `state-change:${input.profileId}:${input.operationId.trim()}`;
  if (input.historyId?.trim()) return `state-change:${input.profileId}:${input.historyId.trim()}`;
  const at = input.occurredAt !== undefined ? `:${toUnixSeconds(input.occurredAt)}` : "";
  return `state-change:${input.profileId}:${input.entryId}:${input.previousState}->${input.nextState}${at}`;
}

/** Deterministic idempotency key for a practice attempt outcome. */
export function buildPracticeAttemptIdempotencyKey(input: {
  profileId: string;
  attemptId: string;
  mode: PracticeAttemptMode | "speaking";
  status?: string;
}): string {
  return `practice:${input.profileId}:${input.attemptId}:${input.mode}:${input.status ?? "submitted"}`;
}

/** Deterministic idempotency key for an SRS review evidence event. */
export function buildReviewEvidenceIdempotencyKey(input: {
  profileId: string;
  reviewId?: string;
  learningItemId?: string;
  entryId?: string;
  reviewedAt?: number;
}): string {
  if (input.reviewId?.trim()) return `srs-review:${input.profileId}:${input.reviewId.trim()}`;
  const item = normalizePart(input.learningItemId ?? input.entryId, "no-item");
  const at = input.reviewedAt !== undefined ? String(toUnixSeconds(input.reviewedAt)) : "0";
  return `srs-review:${input.profileId}:${item}:${at}`;
}

/** Deterministic idempotency key for a reader or listening session. */
export function buildSessionIdempotencyKey(input: {
  profileId: string;
  kind: "reader.session" | "listening.session";
  sessionId?: string;
  documentId?: string;
  mediaId?: string;
  contentFingerprint?: string;
}): string {
  if (input.sessionId?.trim()) return `session:${input.kind}:${input.profileId}:${input.sessionId.trim()}`;
  const source = normalizePart(input.documentId ?? input.mediaId, "no-source");
  const fp = normalizePart(input.contentFingerprint, "no-fp");
  return `session:${input.kind}:${input.profileId}:${source}:${fp}`;
}

/**
 * Emit an analytics event idempotently without throwing on UI paths.
 * Returns false immediately for cache hits, UI re-renders, reopened documents, or cache-render origins.
 */
export async function emitLanguageAnalyticsEvent(input: EmitLanguageAnalyticsEventInput): Promise<boolean> {
  if (!input.profileId?.trim() || !input.eventKind?.trim() || !input.idempotencyKey?.trim()) {
    return false;
  }
  if (
    input.origin === "cache-render" ||
    input.isRerender === true ||
    input.isCacheHit === true ||
    input.isReopenedDocument === true
  ) {
    return false;
  }

  const occurredAt = input.occurredAt !== undefined ? toUnixSeconds(input.occurredAt) : undefined;
  const recorder = input.recordEvent ?? recordLanguageAnalyticsEvent;

  try {
    const accepted = await recorder({
      idempotencyKey: input.idempotencyKey,
      profileId: input.profileId,
      eventKind: input.eventKind,
      payload: input.payload,
      occurredAt,
    });
    return Boolean(accepted);
  } catch {
    return false;
  }
}

export function emitEncounterAnalyticsEvent(input: {
  profileId: string;
  entryId?: string;
  lemma?: string;
  surface?: string;
  knowledgeState?: LanguageKnowledgeState;
  occurrenceKey?: string;
  processingKey?: string;
  documentId?: string;
  sourceId?: string;
  contentFingerprint?: string;
  sentenceId?: string;
  tokenId?: string;
  tokenCount?: number;
  occurredAt?: number;
  origin?: AnalyticsEventOrigin;
  isRerender?: boolean;
  isCacheHit?: boolean;
  isReopenedDocument?: boolean;
  recordEvent?: typeof recordLanguageAnalyticsEvent;
}): Promise<boolean> {
  return emitLanguageAnalyticsEvent({
    profileId: input.profileId,
    eventKind: "lexicon.encounter",
    idempotencyKey: buildEncounterIdempotencyKey(input),
    occurredAt: input.occurredAt,
    origin: input.origin,
    isRerender: input.isRerender,
    isCacheHit: input.isCacheHit,
    isReopenedDocument: input.isReopenedDocument,
    recordEvent: input.recordEvent,
    payload: {
      lemmaId: input.entryId,
      lemma: input.lemma,
      knowledgeState: input.knowledgeState,
      tokenCount: input.tokenCount,
      documentId: input.documentId,
    },
  });
}

export function emitLookupAnalyticsEvent(input: {
  profileId: string;
  lookupId?: string;
  actionId?: string;
  entryId?: string;
  surface?: string;
  documentId?: string;
  mediaId?: string;
  sentenceId?: string;
  tokenId?: string;
  occurredAt?: number;
  origin?: AnalyticsEventOrigin;
  isRerender?: boolean;
  isCacheHit?: boolean;
  recordEvent?: typeof recordLanguageAnalyticsEvent;
}): Promise<boolean> {
  return emitLanguageAnalyticsEvent({
    profileId: input.profileId,
    eventKind: "lexicon.lookup",
    idempotencyKey: buildLookupIdempotencyKey(input),
    occurredAt: input.occurredAt,
    origin: input.origin,
    isRerender: input.isRerender,
    isCacheHit: input.isCacheHit,
    recordEvent: input.recordEvent,
    payload: {
      lemmaId: input.entryId,
      surface: input.surface,
      documentId: input.documentId,
      mediaId: input.mediaId,
      count: 1,
    },
  });
}

export function emitStateChangeAnalyticsEvent(input: {
  profileId: string;
  entryId: string;
  previousState: LanguageKnowledgeState;
  nextState: LanguageKnowledgeState;
  operationId?: string;
  historyId?: string;
  occurredAt?: number;
  origin?: AnalyticsEventOrigin;
  isRerender?: boolean;
  recordEvent?: typeof recordLanguageAnalyticsEvent;
}): Promise<boolean> {
  return emitLanguageAnalyticsEvent({
    profileId: input.profileId,
    eventKind: "knowledge.state-change",
    idempotencyKey: buildStateChangeIdempotencyKey(input),
    occurredAt: input.occurredAt,
    origin: input.origin,
    isRerender: input.isRerender,
    recordEvent: input.recordEvent,
    payload: {
      entryId: input.entryId,
      previousState: input.previousState,
      nextState: input.nextState,
    },
  });
}

export function emitPracticeAttemptAnalyticsEvent(input: {
  attempt: PracticeAttempt;
  origin?: AnalyticsEventOrigin;
  isRerender?: boolean;
  recordEvent?: typeof recordLanguageAnalyticsEvent;
}): Promise<boolean> {
  const { attempt } = input;
  if (attempt.status !== "submitted") return Promise.resolve(false);
  return emitLanguageAnalyticsEvent({
    profileId: attempt.profileId,
    eventKind: "practice.evidence",
    idempotencyKey: buildPracticeAttemptIdempotencyKey({
      profileId: attempt.profileId,
      attemptId: attempt.id,
      mode: attempt.mode,
      status: attempt.status,
    }),
    occurredAt: attempt.updatedAt || attempt.createdAt,
    origin: input.origin,
    isRerender: input.isRerender,
    recordEvent: input.recordEvent,
    payload: {
      attemptId: attempt.id,
      mode: attempt.mode,
      evidence: attempt.activeEvidenceAccepted ? "active" : "passive",
      attempts: 1,
      correct: attempt.comparison?.exact ? 1 : 0,
      confidence: attempt.comparison?.score,
      errorCount: attempt.comparison?.errors.length ?? 0,
    },
  });
}

export function emitReviewEvidenceAnalyticsEvent(input: {
  profileId: string;
  retained: boolean;
  reviewId?: string;
  learningItemId?: string;
  entryId?: string;
  confidence?: number;
  reviewedAt?: number;
  origin?: AnalyticsEventOrigin;
  isRerender?: boolean;
  recordEvent?: typeof recordLanguageAnalyticsEvent;
}): Promise<boolean> {
  return emitLanguageAnalyticsEvent({
    profileId: input.profileId,
    eventKind: "srs.review",
    idempotencyKey: buildReviewEvidenceIdempotencyKey(input),
    occurredAt: input.reviewedAt,
    origin: input.origin,
    isRerender: input.isRerender,
    recordEvent: input.recordEvent,
    payload: {
      retained: input.retained,
      confidence: input.confidence,
      entryId: input.entryId,
      learningItemId: input.learningItemId,
    },
  });
}

function emptyVocabCounts(): VocabStateCounts {
  return {
    known: 0,
    familiar: 0,
    learning: 0,
    new: 0,
    encountered: 0,
    ignored: 0,
    totalActive: 0,
    total: 0,
  };
}

function incrementVocabCount(counts: VocabStateCounts, state: LanguageKnowledgeState): void {
  counts[state] += 1;
  counts.total += 1;
  if (state !== "ignored") counts.totalActive += 1;
}

function createEmptyErrorBreakdown(): Record<ComparisonErrorKind, number> {
  return {
    missing: 0,
    extra: 0,
    substitution: 0,
    punctuation: 0,
    diacritic: 0,
    order: 0,
    script: 0,
  };
}

function resolveKnowledgeState(
  rawState: string | undefined,
  ignored = false,
): LanguageKnowledgeState {
  if (ignored) return "ignored";
  if (rawState && VALID_KNOWLEDGE_STATES.has(rawState as LanguageKnowledgeState)) {
    return rawState as LanguageKnowledgeState;
  }
  return "new";
}

function resolveLemmaKey(entry: LanguageLexicalEntry): string {
  const base =
    entry.lemma?.trim() ||
    entry.lexicalKey?.trim() ||
    entry.normalizedForm.trim() ||
    entry.canonicalForm.trim() ||
    entry.id;
  return `${entry.languageTag.toLowerCase()}:${base.toLowerCase()}`;
}

function higherKnowledgeState(
  current: LanguageKnowledgeState | undefined,
  candidate: LanguageKnowledgeState,
): LanguageKnowledgeState {
  if (!current) return candidate;
  if (current === "ignored") return candidate;
  if (candidate === "ignored") return current;
  return STATE_RANK[candidate] > STATE_RANK[current] ? candidate : current;
}

function inRangeMs(timestampMs: number | undefined, range: Required<AnalyticsDateRange>): boolean {
  if (timestampMs === undefined || !Number.isFinite(timestampMs) || timestampMs <= 0) return false;
  return timestampMs >= range.from && timestampMs < range.to;
}

async function paginateLexicon<T>(
  fetchPage: (offset: number, limit: number) => Promise<LexiconPage<T> | undefined>,
  pageSize: number,
  maxPages: number,
): Promise<T[]> {
  const items: T[] = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchPage(offset, pageSize);
    if (!page || !Array.isArray(page.items) || page.items.length === 0) break;
    items.push(...page.items);
    if (!page.hasMore) break;
    offset += page.items.length;
  }
  return items;
}

async function fetchAllPracticeAttempts(
  profileId: string,
  loader: NonNullable<LanguageAnalyticsLoaders["listPracticeAttempts"]>,
  pageSize: number,
  maxPages: number,
): Promise<PracticeAttempt[]> {
  const items: PracticeAttempt[] = [];
  let offset = 0;
  const boundedLimit = Math.min(200, Math.max(1, pageSize));
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const rows = await loader(profileId, { offset, limit: boundedLimit });
    if (!Array.isArray(rows) || rows.length === 0) break;
    items.push(...rows);
    if (rows.length < boundedLimit) break;
    offset += rows.length;
  }
  return items;
}

function summarizeVocabulary(
  entries: readonly LanguageLexicalEntry[],
  snapshotMap: ReadonlyMap<string, LanguageKnowledgeStateSnapshot>,
): {
  lemmas: VocabStateCounts;
  exactForms: VocabStateCounts;
  lemmaStatesForMetrics: Map<string, LanguageKnowledgeState>;
} {
  const exactForms = emptyVocabCounts();
  const lemmaStateMap = new Map<string, LanguageKnowledgeState>();
  const seenEntryIds = new Set<string>();

  for (const entry of entries) {
    seenEntryIds.add(entry.id);
    const snapshot = snapshotMap.get(entry.id);
    const state = resolveKnowledgeState(
      snapshot?.state ?? entry.knowledgeState,
      entry.ignored || snapshot?.state === "ignored",
    );
    incrementVocabCount(exactForms, state);

    const lemmaKey = resolveLemmaKey(entry);
    lemmaStateMap.set(lemmaKey, higherKnowledgeState(lemmaStateMap.get(lemmaKey), state));
  }

  for (const [entryId, snapshot] of snapshotMap.entries()) {
    if (seenEntryIds.has(entryId)) continue;
    const state = resolveKnowledgeState(snapshot.state);
    incrementVocabCount(exactForms, state);
    const fallbackLemmaKey = `unlinked:${entryId}`;
    lemmaStateMap.set(
      fallbackLemmaKey,
      higherKnowledgeState(lemmaStateMap.get(fallbackLemmaKey), state),
    );
  }

  const lemmas = emptyVocabCounts();
  const lemmaStatesForMetrics = new Map<string, LanguageKnowledgeState>();
  for (const [lemmaKey, state] of lemmaStateMap.entries()) {
    incrementVocabCount(lemmas, state);
    if (state !== "ignored") {
      lemmaStatesForMetrics.set(lemmaKey, state);
    }
  }

  return { lemmas, exactForms, lemmaStatesForMetrics };
}

function readNumericMetric(record: LanguageAnalyticsDailyRecord, keys: readonly string[]): number {
  for (const key of keys) {
    const val = record.metrics[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return 0;
}

function hasAnyMetricKey(records: readonly LanguageAnalyticsDailyRecord[], keys: readonly string[]): boolean {
  return records.some((record) =>
    keys.some((key) => typeof record.metrics[key] === "number" && Number.isFinite(record.metrics[key])),
  );
}

function readCoverageNumbers(record: LanguageCoverageResultRecord): {
  analyzedTokens: number;
  knownTokens: number;
  unknownTokens: number;
  knownCoverageRatio: number | null;
  coverageRatio: number | null;
  unknownDensity: number | null;
  difficultyScore: number | null;
  difficultyBand?: string;
  difficultyLabel?: string;
} {
  const summary = record.summary ?? {};
  const stateCounts = (summary.stateCounts ?? {}) as Record<string, unknown>;
  const analyzedRaw = summary.totalCountedTokens ?? summary.analyzedTokens;
  const analyzedTokens = typeof analyzedRaw === "number" && Number.isFinite(analyzedRaw) ? analyzedRaw : 0;

  let knownTokens = 0;
  if (typeof summary.knownTokens === "number" && Number.isFinite(summary.knownTokens)) {
    knownTokens = summary.knownTokens;
  } else if (typeof stateCounts.known === "number" && Number.isFinite(stateCounts.known)) {
    knownTokens = stateCounts.known;
  } else if (typeof summary.knownCoveragePercent === "number" && analyzedTokens > 0) {
    knownTokens = Math.round((summary.knownCoveragePercent / 100) * analyzedTokens);
  }

  let unknownTokens = 0;
  if (typeof summary.unknownTokens === "number" && Number.isFinite(summary.unknownTokens)) {
    unknownTokens = summary.unknownTokens;
  } else if (typeof stateCounts.new === "number" || typeof stateCounts.unresolved === "number") {
    unknownTokens =
      (typeof stateCounts.new === "number" ? stateCounts.new : 0) +
      (typeof stateCounts.unresolved === "number" ? stateCounts.unresolved : 0);
  } else if (typeof summary.unknownPercent === "number" && analyzedTokens > 0) {
    unknownTokens = Math.round((summary.unknownPercent / 100) * analyzedTokens);
  }

  const coverageRatio =
    typeof summary.coveragePercent === "number" && Number.isFinite(summary.coveragePercent)
      ? summary.coveragePercent / 100
      : analyzedTokens > 0
        ? knownTokens / analyzedTokens
        : null;
  const knownCoverageRatio =
    typeof summary.knownCoveragePercent === "number" && Number.isFinite(summary.knownCoveragePercent)
      ? summary.knownCoveragePercent / 100
      : analyzedTokens > 0
        ? knownTokens / analyzedTokens
        : null;
  const unknownDensity =
    typeof summary.unknownPercent === "number" && Number.isFinite(summary.unknownPercent)
      ? summary.unknownPercent / 100
      : analyzedTokens > 0
        ? unknownTokens / analyzedTokens
        : null;
  const difficultyScore =
    typeof summary.difficultyScore === "number" && Number.isFinite(summary.difficultyScore)
      ? summary.difficultyScore
      : null;

  return {
    analyzedTokens,
    knownTokens,
    unknownTokens,
    knownCoverageRatio,
    coverageRatio,
    unknownDensity,
    difficultyScore,
    difficultyBand: typeof summary.difficultyBand === "string" ? summary.difficultyBand : undefined,
    difficultyLabel: typeof summary.difficultyLabel === "string" ? summary.difficultyLabel : undefined,
  };
}

function deriveAvailability(
  sampleSize: number,
  minimumSampleSize: number,
  freshness: FreshnessMetadata["status"],
  available = true,
  insufficientReason = "insufficient_evidence",
): { status: EvidenceAvailabilityStatus; reason?: string } {
  if (!available) return { status: "unavailable", reason: "capability_unavailable" };
  if (sampleSize < minimumSampleSize) {
    if (freshness === "pending") return { status: "pending", reason: "pending_computation" };
    return { status: "insufficient-evidence", reason: insufficientReason };
  }
  if (freshness === "pending") return { status: "pending", reason: "pending_computation" };
  if (freshness === "stale") return { status: "stale", reason: "aggregate_stale" };
  return { status: "ready" };
}

/**
 * Load and aggregate profile-scoped language analytics across daily rollups, lexicon,
 * knowledge state/history/evidence, practice attempts, and coverage results.
 */
export async function loadLanguageAnalyticsDashboardData(
  profileId: string,
  range?: AnalyticsDateRange,
  options: LoadLanguageAnalyticsOptions = {},
): Promise<LanguageAnalyticsDashboardData> {
  const now = options.now ?? Date.now();
  const minSampleSize = Math.max(1, options.minimumSampleSize ?? 1);
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const fallbackRange: AnalyticsDateRange = {
    from: now - 30 * DAY_MS,
    to: now + 1,
    timeZone: DEFAULT_ANALYTICS_TIME_ZONE,
  };
  const normalizedFilter = normalizeAnalyticsFilter(
    {
      profileId,
      dateRange: range ? normalizeDateRange(range) : undefined,
      languageTag: options.languageTag,
      documentId: options.documentId,
      sourceType: options.sourceType,
    },
    fallbackRange,
  );
  const activeRange = normalizedFilter.dateRange;
  const startDay = toDayUtc(activeRange.from);
  const endDay = toDayUtc(Math.max(activeRange.from, activeRange.to - 1));

  const loaders: Required<LanguageAnalyticsLoaders> = {
    listDaily: options.loaders?.listDaily ?? listLanguageAnalyticsDaily,
    exportKnowledge: options.loaders?.exportKnowledge ?? exportLanguageKnowledge,
    listKnowledgeStates: options.loaders?.listKnowledgeStates ?? listLanguageKnowledgeStates,
    listLexicalEntries: options.loaders?.listLexicalEntries ?? listLanguageLexicalEntries,
    listLookupEvents: options.loaders?.listLookupEvents ?? listLanguageLookupEvents,
    listPracticeAttempts: options.loaders?.listPracticeAttempts ?? listLanguagePracticeAttempts,
    getCoverageResults: options.loaders?.getCoverageResults ?? getLanguageCoverageResults,
  };

  const [
    rawDaily,
    knowledgeExport,
    lexicalEntries,
    lookupEvents,
    practiceAttempts,
    coverageResults,
  ] = await Promise.all([
    loaders.listDaily(profileId, { startDay, endDay }).catch(() => [] as LanguageAnalyticsDailyRecord[]),
    loaders.exportKnowledge(profileId).catch(() => null),
    paginateLexicon(
      (offset, limit) =>
        loaders.listLexicalEntries(profileId, {
          languageTag: options.languageTag,
          offset,
          limit,
        }),
      pageSize,
      maxPages,
    ).catch(() => [] as LanguageLexicalEntry[]),
    paginateLexicon(
      (offset, limit) => loaders.listLookupEvents(profileId, { offset, limit }),
      pageSize,
      maxPages,
    ).catch(() => [] as LanguageLookupEvent[]),
    fetchAllPracticeAttempts(profileId, loaders.listPracticeAttempts, pageSize, maxPages).catch(
      () => [] as PracticeAttempt[],
    ),
    loaders.getCoverageResults(profileId).catch(() => [] as LanguageCoverageResultRecord[]),
  ]);

  let knowledgeStates: LanguageKnowledgeStateSnapshot[] = knowledgeExport?.states ?? [];
  if (knowledgeStates.length === 0) {
    knowledgeStates = await paginateLexicon<LanguageKnowledgeStateSnapshot>(
      (offset, limit) => loaders.listKnowledgeStates(profileId, { offset, limit }),
      pageSize,
      maxPages,
    ).catch(() => [] as LanguageKnowledgeStateSnapshot[]);
  }
  const knowledgeHistory: readonly LanguageKnowledgeStateHistory[] = knowledgeExport?.history ?? [];
  const knowledgeEvidence: readonly LanguageKnowledgeEvidenceEvent[] = knowledgeExport?.evidence ?? [];

  const languageTagFilter = options.languageTag?.toLowerCase();
  const filteredEntries = lexicalEntries.filter(
    (entry) =>
      entry.profileId === profileId &&
      (!languageTagFilter || entry.languageTag.toLowerCase() === languageTagFilter),
  );
  const entryById = new Map<string, LanguageLexicalEntry>(
    filteredEntries.map((entry) => [entry.id, entry]),
  );

  const filteredSnapshots = knowledgeStates.filter(
    (snapshot) =>
      snapshot.profileId === profileId &&
      (!languageTagFilter || entryById.has(snapshot.lexicalEntryId)),
  );
  const snapshotMap = new Map<string, LanguageKnowledgeStateSnapshot>(
    filteredSnapshots.map((snapshot) => [snapshot.lexicalEntryId, snapshot]),
  );

  // Date-range filtering on daily records (by both dayUtc bounds and millisecond bounds).
  const dailyRecords = rawDaily
    .filter((record) => {
      if (record.profileId !== profileId) return false;
      if (record.dayUtc < startDay || record.dayUtc > endDay) return false;
      const bounds = utcDayToBoundsMs(record.dayUtc);
      if (!bounds) return false;
      return bounds.end > activeRange.from && bounds.start < activeRange.to;
    })
    .sort((a, b) => a.dayUtc.localeCompare(b.dayUtc));

  // Filter history, evidence, lookup events, practice attempts, and coverage via activeRange and filters.ts.
  const historyInRange = knowledgeHistory.filter((item) => {
    if (item.profileId !== profileId || item.revertedAt) return false;
    if (languageTagFilter && !entryById.has(item.lexicalEntryId)) return false;
    const occurredAt = toUnixMillis(item.changedAt);
    const synthetic: LanguageAnalyticsEvent = {
      eventId: item.id,
      profileId: item.profileId,
      kind: "knowledge.state-change",
      occurredAt,
      sourceType: "lexicon",
      languageTag: entryById.get(item.lexicalEntryId)?.languageTag,
      payload: {
        entryId: item.lexicalEntryId,
        previousState: item.previousState,
        nextState: item.newState,
      },
    };
    return eventMatchesFilter(synthetic, normalizedFilter);
  });

  const evidenceInRange = knowledgeEvidence.filter((item) => {
    if (item.profileId !== profileId) return false;
    if (languageTagFilter && !entryById.has(item.lexicalEntryId)) return false;
    return inRangeMs(toUnixMillis(item.occurredAt), activeRange);
  });

  const lookupsInRange = lookupEvents.filter((item) => {
    if (item.profileId && item.profileId !== profileId) return false;
    if (languageTagFilter && item.lexicalEntryId && !entryById.has(item.lexicalEntryId)) return false;
    if (options.documentId && item.documentId !== options.documentId) return false;
    return inRangeMs(toUnixMillis(item.lookedUpAt), activeRange);
  });

  const attemptsInRange = practiceAttempts.filter((attempt) => {
    if (attempt.profileId !== profileId) return false;
    if (options.documentId && attempt.source.sourceId !== options.documentId) return false;
    const at = toUnixMillis(attempt.updatedAt || attempt.createdAt);
    return inRangeMs(at, activeRange);
  });

  const coverageInRange = coverageResults.filter((record) => {
    if (record.profileId !== profileId) return false;
    if (options.documentId && record.documentId !== options.documentId) return false;
    const at = toUnixMillis(record.computedAt ?? record.updatedAt);
    return inRangeMs(at, activeRange);
  });

  // Vocabulary counts: lemmas vs exact forms.
  const vocabSummary = summarizeVocabulary(filteredEntries, snapshotMap);
  const entriesActiveInRange = filteredEntries.filter((entry) =>
    inRangeMs(toUnixMillis(entry.lastEncounteredAt ?? entry.updatedAt ?? entry.createdAt), activeRange),
  );
  const snapshotsActiveInRange = new Map<string, LanguageKnowledgeStateSnapshot>();
  for (const snapshot of filteredSnapshots) {
    if (inRangeMs(toUnixMillis(snapshot.lastEvidenceAt ?? snapshot.updatedAt), activeRange)) {
      snapshotsActiveInRange.set(snapshot.lexicalEntryId, snapshot);
    }
  }
  const activeVocabInRange = summarizeVocabulary(entriesActiveInRange, snapshotsActiveInRange);

  const stateMovementsInRange: StateMovementSummary = {
    total: historyInRange.length,
    transitions: {},
  };
  for (const item of historyInRange) {
    const key = `${item.previousState}->${item.newState}`;
    stateMovementsInRange.transitions[key] = (stateMovementsInRange.transitions[key] ?? 0) + 1;
  }

  // Daily aggregates and vocab growth time series.
  let dailyEncounters = 0;
  let dailyLookups = 0;
  let dailyStateChanges = 0;
  let dailyReadingSessions = 0;
  let dailyReadingSeconds = 0;
  let dailyReadingTokens = 0;
  let dailyListeningSessions = 0;
  let dailyListeningSeconds = 0;
  let dailyListeningSentences = 0;
  let dailyPracticeEvents = 0;
  let dailySrsReviews = 0;
  let dailySrsRetained = 0;
  let latestDailyUpdatedAt: number | undefined;

  for (const record of dailyRecords) {
    dailyEncounters += readNumericMetric(record, ["lexicon.encounter", "exposure.encounters"]);
    dailyLookups += readNumericMetric(record, ["lexicon.lookup", "lookup.count"]);
    dailyStateChanges += readNumericMetric(record, ["knowledge.state-change", "state.movement_count"]);
    dailyReadingSessions += readNumericMetric(record, ["reader.session", "activity.reading_sessions"]);
    dailyReadingSeconds +=
      readNumericMetric(record, ["reader.duration_seconds", "readingSeconds"]) ||
      readNumericMetric(record, ["activity.reading_minutes"]) * 60;
    dailyReadingTokens += readNumericMetric(record, ["reader.tokens", "activity.reading_tokens", "readingTokens"]);
    dailyListeningSessions += readNumericMetric(record, ["listening.session", "activity.listening_sessions"]);
    dailyListeningSeconds +=
      readNumericMetric(record, ["listening.duration_seconds", "listeningSeconds"]) ||
      readNumericMetric(record, ["activity.listening_minutes"]) * 60;
    dailyListeningSentences += readNumericMetric(record, [
      "listening.sentences",
      "activity.listening_sentences",
      "listeningSentences",
    ]);
    dailyPracticeEvents += readNumericMetric(record, ["practice.evidence"]);
    dailySrsReviews += readNumericMetric(record, ["srs.review"]);
    dailySrsRetained += readNumericMetric(record, ["srs.retained"]);

    const updatedMs = toUnixMillis(record.updatedAt);
    if (updatedMs > 0 && (latestDailyUpdatedAt === undefined || updatedMs > latestDailyUpdatedAt)) {
      latestDailyUpdatedAt = updatedMs;
    }
  }

  const hasReadingDurationData = hasAnyMetricKey(dailyRecords, [
    "reader.duration_seconds",
    "readingSeconds",
    "activity.reading_minutes",
  ]);
  const hasReadingTokensData = hasAnyMetricKey(dailyRecords, [
    "reader.tokens",
    "activity.reading_tokens",
    "readingTokens",
  ]);
  const hasListeningDurationData = hasAnyMetricKey(dailyRecords, [
    "listening.duration_seconds",
    "listeningSeconds",
    "activity.listening_minutes",
  ]);
  const hasListeningSentenceData = hasAnyMetricKey(dailyRecords, [
    "listening.sentences",
    "activity.listening_sentences",
    "listeningSentences",
  ]);
  const hasSrsRetentionOutcomeData = hasAnyMetricKey(dailyRecords, ["srs.retained"]);

  // Build day-by-day vocab growth series using analyticsBucketStart in UTC + dailyRecords + history + entries.
  const dayGrowthMap = new Map<string, VocabGrowthDayPoint>();
  const ensureDayPoint = (dayUtc: string): VocabGrowthDayPoint => {
    let point = dayGrowthMap.get(dayUtc);
    if (!point) {
      point = {
        dayUtc,
        encounters: 0,
        lookups: 0,
        stateChanges: 0,
        newLemmas: 0,
        newExactForms: 0,
        knownTransitions: 0,
        cumulativeKnownLemmas: 0,
        readingSessions: 0,
        listeningSessions: 0,
        practiceEvents: 0,
        srsReviews: 0,
        totalEvents: 0,
      };
      dayGrowthMap.set(dayUtc, point);
    }
    return point;
  };

  for (const record of dailyRecords) {
    const point = ensureDayPoint(record.dayUtc);
    point.encounters += readNumericMetric(record, ["lexicon.encounter", "exposure.encounters"]);
    point.lookups += readNumericMetric(record, ["lexicon.lookup", "lookup.count"]);
    point.stateChanges += readNumericMetric(record, ["knowledge.state-change", "state.movement_count"]);
    point.readingSessions += readNumericMetric(record, ["reader.session", "activity.reading_sessions"]);
    point.listeningSessions += readNumericMetric(record, ["listening.session", "activity.listening_sessions"]);
    point.practiceEvents += readNumericMetric(record, ["practice.evidence"]);
    point.srsReviews += readNumericMetric(record, ["srs.review"]);
    point.totalEvents += record.eventCursor;
  }

  const seenNewLemmaKeys = new Set<string>();
  const sortedEntriesByFirstSeen = [...filteredEntries].sort(
    (a, b) => toUnixMillis(a.firstEncounteredAt ?? a.createdAt) - toUnixMillis(b.firstEncounteredAt ?? b.createdAt),
  );
  for (const entry of sortedEntriesByFirstSeen) {
    const firstSeenMs = toUnixMillis(entry.firstEncounteredAt ?? entry.createdAt);
    if (!inRangeMs(firstSeenMs, activeRange)) continue;
    const dayUtc = analyticsBucketStart(firstSeenMs, "day", DEFAULT_ANALYTICS_TIME_ZONE);
    const point = ensureDayPoint(dayUtc);
    point.newExactForms += 1;
    const lemmaKey = resolveLemmaKey(entry);
    if (!seenNewLemmaKeys.has(lemmaKey)) {
      seenNewLemmaKeys.add(lemmaKey);
      point.newLemmas += 1;
    }
  }

  const knownLemmaSetBeforeRange = new Set<string>();
  const knownLemmaByDay = new Map<string, Set<string>>();
  for (const item of historyInRange) {
    const dayUtc = analyticsBucketStart(toUnixMillis(item.changedAt), "day", DEFAULT_ANALYTICS_TIME_ZONE);
    const point = ensureDayPoint(dayUtc);
    if (dailyRecords.length === 0) point.stateChanges += 1;
    if (item.newState === "known" && item.previousState !== "known") {
      point.knownTransitions += 1;
      const entry = entryById.get(item.lexicalEntryId);
      const lemmaKey = entry ? resolveLemmaKey(entry) : `unlinked:${item.lexicalEntryId}`;
      let set = knownLemmaByDay.get(dayUtc);
      if (!set) {
        set = new Set();
        knownLemmaByDay.set(dayUtc, set);
      }
      set.add(lemmaKey);
    }
  }

  // Baseline known lemmas that existed before range start (excluding those transitioned into known during range).
  const knownTransitionedInRange = new Set<string>();
  for (const set of knownLemmaByDay.values()) {
    for (const key of set) knownTransitionedInRange.add(key);
  }
  for (const [lemmaKey, state] of vocabSummary.lemmaStatesForMetrics.entries()) {
    if (state === "known" && !knownTransitionedInRange.has(lemmaKey)) {
      knownLemmaSetBeforeRange.add(lemmaKey);
    }
  }

  const vocabGrowthByDay = [...dayGrowthMap.values()].sort((a, b) => a.dayUtc.localeCompare(b.dayUtc));
  let runningKnown = knownLemmaSetBeforeRange.size;
  for (const point of vocabGrowthByDay) {
    runningKnown += knownLemmaByDay.get(point.dayUtc)?.size ?? point.knownTransitions;
    point.cumulativeKnownLemmas = runningKnown;
  }

  // Practice breakdown by mode and error category.
  const practiceByMode = {} as Record<PracticeAttemptMode, PracticeModeBreakdown>;
  const totalErrorsByCategory = createEmptyErrorBreakdown();
  let totalErrors = 0;
  let totalSubmittedAttempts = 0;
  let totalAcceptedActiveAttempts = 0;
  let totalScoreSum = 0;
  let totalScoreSamples = 0;

  for (const mode of PRACTICE_ATTEMPT_MODES) {
    const modeAttempts = attemptsInRange.filter((attempt) => attempt.mode === mode);
    const submitted = modeAttempts.filter((attempt) => attempt.status === "submitted");
    const acceptedActive = submitted.filter((attempt) => attempt.activeEvidenceAccepted);
    const exactCount = submitted.filter((attempt) => attempt.comparison?.exact).length;
    const uncertainCount = submitted.filter((attempt) => attempt.comparison?.uncertain).length;
    const assistedCount = submitted.filter((attempt) => attempt.comparison?.assisted).length;
    const errorsByCategory = createEmptyErrorBreakdown();
    let modeErrors = 0;
    let modeScoreSum = 0;
    let modeScoreSamples = 0;

    for (const attempt of submitted) {
      if (attempt.comparison) {
        if (Number.isFinite(attempt.comparison.score)) {
          modeScoreSum += attempt.comparison.score;
          modeScoreSamples += 1;
        }
        for (const err of attempt.comparison.errors) {
          if (ERROR_CATEGORIES.includes(err.kind)) {
            errorsByCategory[err.kind] += 1;
            totalErrorsByCategory[err.kind] += 1;
            modeErrors += 1;
            totalErrors += 1;
          }
        }
      }
    }

    totalSubmittedAttempts += submitted.length;
    totalAcceptedActiveAttempts += acceptedActive.length;
    totalScoreSum += modeScoreSum;
    totalScoreSamples += modeScoreSamples;

    const modeAvailable =
      mode === "pronunciation" || mode === "shadowing"
        ? options.speakingAvailable ?? modeAttempts.length > 0
        : mode === "writing"
          ? options.writingAvailable ?? modeAttempts.length > 0
          : true;

    const modeStatus = deriveAvailability(
      submitted.length,
      minSampleSize,
      "fresh",
      modeAvailable,
      "no_submitted_practice_attempts",
    );

    practiceByMode[mode] = {
      mode,
      status: modeStatus.status,
      attempts: modeAttempts.length,
      submitted: submitted.length,
      acceptedActive: acceptedActive.length,
      exactCount,
      uncertainCount,
      assistedCount,
      averageScore: modeScoreSamples > 0 ? modeScoreSum / modeScoreSamples : null,
      totalErrors: modeErrors,
      errorsByCategory,
      ...(modeStatus.reason ? { reason: modeStatus.reason } : {}),
    };
  }

  // Passive & active evidence summaries.
  const passiveEvidence: EvidenceSummary = {
    count: 0,
    correct: 0,
    confidenceTotal: 0,
    confidenceSamples: 0,
    sources: {},
  };
  const activeEvidence: EvidenceSummary = {
    count: 0,
    correct: 0,
    confidenceTotal: 0,
    confidenceSamples: 0,
    sources: {},
  };

  let knowledgeLookupEvidenceCount = 0;
  for (const ev of evidenceInRange) {
    if (ev.kind === "encounter" || ev.kind === "recognition") {
      passiveEvidence.count += 1;
      passiveEvidence.sources.reading = (passiveEvidence.sources.reading ?? 0) + 1;
      if (typeof ev.confidence === "number" && Number.isFinite(ev.confidence)) {
        passiveEvidence.confidenceTotal += ev.confidence;
        passiveEvidence.confidenceSamples += 1;
      }
    } else if (ev.kind === "production") {
      activeEvidence.count += 1;
      activeEvidence.correct += 1;
      if (typeof ev.confidence === "number" && Number.isFinite(ev.confidence)) {
        activeEvidence.confidenceTotal += ev.confidence;
        activeEvidence.confidenceSamples += 1;
      }
    } else if (ev.kind === "lookup") {
      knowledgeLookupEvidenceCount += 1;
    }
  }

  for (const attempt of attemptsInRange) {
    if (attempt.status !== "submitted") continue;
    const sourceKey: keyof EvidenceSummary["sources"] =
      attempt.mode === "pronunciation" ? "speaking" : attempt.mode;
    if (attempt.activeEvidenceAccepted) {
      activeEvidence.count += 1;
      if (attempt.comparison?.exact) activeEvidence.correct += 1;
      activeEvidence.sources[sourceKey] = (activeEvidence.sources[sourceKey] ?? 0) + 1;
      if (attempt.comparison && Number.isFinite(attempt.comparison.score)) {
        activeEvidence.confidenceTotal += attempt.comparison.score;
        activeEvidence.confidenceSamples += 1;
      }
    } else {
      passiveEvidence.count += 1;
      passiveEvidence.sources[sourceKey] = (passiveEvidence.sources[sourceKey] ?? 0) + 1;
      if (attempt.comparison && Number.isFinite(attempt.comparison.score)) {
        passiveEvidence.confidenceTotal += attempt.comparison.score;
        passiveEvidence.confidenceSamples += 1;
      }
    }
  }

  if (dailyEncounters > 0) {
    passiveEvidence.count += dailyEncounters;
    passiveEvidence.sources.reading = (passiveEvidence.sources.reading ?? 0) + dailyEncounters;
  }
  if (dailySrsReviews > 0) {
    activeEvidence.count += dailySrsReviews;
    activeEvidence.sources.review = (activeEvidence.sources.review ?? 0) + dailySrsReviews;
  }

  // Coverage summary & progression.
  const coverageSummary: CoverageSummary = {
    analyzedTokens: 0,
    knownTokens: 0,
    unknownTokens: 0,
    readyDocuments: 0,
    pendingDocuments: 0,
    staleDocuments: 0,
    difficultyTotal: 0,
    difficultySamples: 0,
  };
  let unavailableOrFailedDocuments = 0;
  const coverageProgression: CoverageProgressionPoint[] = [];
  let latestCoverageComputedAt: number | undefined;

  const sortedCoverage = [...coverageInRange].sort(
    (a, b) => toUnixMillis(a.computedAt ?? a.updatedAt) - toUnixMillis(b.computedAt ?? b.updatedAt),
  );

  for (const record of sortedCoverage) {
    const computedMs = toUnixMillis(record.computedAt ?? record.updatedAt);
    if (computedMs > 0 && (latestCoverageComputedAt === undefined || computedMs > latestCoverageComputedAt)) {
      latestCoverageComputedAt = computedMs;
    }
    const numbers = readCoverageNumbers(record);

    if (record.freshness === "fresh") {
      coverageSummary.readyDocuments += 1;
      coverageSummary.analyzedTokens += numbers.analyzedTokens;
      coverageSummary.knownTokens += numbers.knownTokens;
      coverageSummary.unknownTokens += numbers.unknownTokens;
      if (numbers.difficultyScore !== null) {
        coverageSummary.difficultyTotal += numbers.difficultyScore;
        coverageSummary.difficultySamples += 1;
      }
    } else if (record.freshness === "pending") {
      coverageSummary.pendingDocuments += 1;
    } else if (record.freshness === "stale") {
      coverageSummary.staleDocuments += 1;
    } else {
      unavailableOrFailedDocuments += 1;
    }

    coverageProgression.push({
      coverageKey: record.coverageKey,
      documentId: record.documentId,
      computedAt: computedMs,
      dayUtc: toDayUtc(computedMs),
      freshness: record.freshness,
      analyzedTokens: numbers.analyzedTokens,
      knownTokens: numbers.knownTokens,
      unknownTokens: numbers.unknownTokens,
      coverageRatio: record.freshness === "fresh" ? numbers.coverageRatio : null,
      knownCoverageRatio: record.freshness === "fresh" ? numbers.knownCoverageRatio : null,
      unknownDensity: record.freshness === "fresh" ? numbers.unknownDensity : null,
      difficultyScore: record.freshness === "fresh" ? numbers.difficultyScore : null,
      difficultyBand: numbers.difficultyBand,
      difficultyLabel: numbers.difficultyLabel,
    });
  }

  // Lookup frequency & repetition.
  const totalLookupsInRange =
    lookupsInRange.length > 0
      ? lookupsInRange.length
      : dailyLookups > 0
        ? dailyLookups
        : knowledgeLookupEvidenceCount;
  const lookupRepetitionEntries = entriesActiveInRange.filter((entry) => entry.lookupCount > 0);
  const repeatedLookupEntries = lookupRepetitionEntries.filter((entry) => entry.lookupCount >= 2);
  const repetitionRate =
    lookupRepetitionEntries.length > 0
      ? repeatedLookupEntries.length / lookupRepetitionEntries.length
      : null;

  const topRepeatedLookups: RepeatedLookupItem[] = [...lookupRepetitionEntries]
    .sort((a, b) => b.lookupCount - a.lookupCount || b.encounterCount - a.encounterCount)
    .slice(0, 10)
    .map((entry) => {
      const snapshot = snapshotMap.get(entry.id);
      return {
        entryId: entry.id,
        lemma: entry.lemma,
        normalizedForm: entry.normalizedForm,
        canonicalForm: entry.canonicalForm,
        lookupCount: entry.lookupCount,
        encounterCount: entry.encounterCount,
        knowledgeState: resolveKnowledgeState(
          snapshot?.state ?? entry.knowledgeState,
          entry.ignored || snapshot?.state === "ignored",
        ),
      };
    });

  const totalEntryEncounters = filteredEntries.reduce((sum, entry) => sum + entry.encounterCount, 0);
  const effectiveEncounters = dailyEncounters > 0 ? dailyEncounters : totalEntryEncounters;
  const averageEncountersPerLemma =
    vocabSummary.lemmas.totalActive > 0 ? effectiveEncounters / vocabSummary.lemmas.totalActive : null;

  // Freshness derivation across sources.
  const latestSourceTimestamp = [
    latestDailyUpdatedAt,
    latestCoverageComputedAt,
    ...filteredSnapshots.map((s) => toUnixMillis(s.updatedAt)),
    ...attemptsInRange.map((a) => toUnixMillis(a.updatedAt || a.createdAt)),
  ].reduce<number | undefined>(
    (max, ts) => (ts !== undefined && ts > 0 && (max === undefined || ts > max) ? ts : max),
    undefined,
  );

  const freshness = deriveFreshness({
    computedAt: latestSourceTimestamp,
    sourceThrough: latestSourceTimestamp,
    now,
    staleAfterMs: options.staleAfterMs,
    pending: coverageSummary.pendingDocuments > 0 && coverageSummary.readyDocuments === 0,
  });

  // Compute formula catalog metrics cleanly.
  const observedEventKinds = new Set<AnalyticsEventKind>();
  if (dailyEncounters > 0 || evidenceInRange.some((e) => e.kind === "encounter")) {
    observedEventKinds.add("lexicon.encounter");
  }
  if (totalLookupsInRange > 0) observedEventKinds.add("lexicon.lookup");
  if (
    stateMovementsInRange.total > 0 ||
    dailyStateChanges > 0 ||
    filteredEntries.length > 0 ||
    filteredSnapshots.length > 0
  ) {
    observedEventKinds.add("knowledge.state-change");
  }
  if (dailyReadingSessions > 0 || dailyReadingSeconds > 0 || dailyReadingTokens > 0) {
    observedEventKinds.add("reader.session");
  }
  if (dailyListeningSessions > 0 || dailyListeningSeconds > 0 || dailyListeningSentences > 0) {
    observedEventKinds.add("listening.session");
  }
  if (totalSubmittedAttempts > 0 || dailyPracticeEvents > 0) {
    observedEventKinds.add("practice.evidence");
  }
  if (
    coverageSummary.readyDocuments > 0 ||
    coverageSummary.pendingDocuments > 0 ||
    coverageSummary.staleDocuments > 0
  ) {
    observedEventKinds.add("coverage.snapshot");
  }
  if (dailySrsReviews > 0 && hasSrsRetentionOutcomeData) {
    observedEventKinds.add("srs.review");
  }

  const uniqueLemmaIdsInRange = new Set<string>(entriesActiveInRange.map(resolveLemmaKey));
  const documentIdsInRange = new Set<string>();
  for (const record of coverageInRange) documentIdsInRange.add(record.documentId);
  for (const ev of lookupsInRange) {
    if (ev.documentId) documentIdsInRange.add(ev.documentId);
  }
  for (const attempt of attemptsInRange) {
    if (attempt.source.sourceId) documentIdsInRange.add(attempt.source.sourceId);
  }

  const speakingOutputs =
    practiceByMode.pronunciation.submitted + practiceByMode.shadowing.submitted;
  const writingOutputs = practiceByMode.writing.submitted;

  const formulaInput: MetricFormulaInput = {
    observedEventKinds,
    lemmaStates: vocabSummary.lemmaStatesForMetrics,
    encounters: effectiveEncounters,
    uniqueLemmaIds: uniqueLemmaIdsInRange,
    documentIds: documentIdsInRange,
    lookups: totalLookupsInRange,
    readingSessions: dailyReadingSessions,
    readingSeconds: dailyReadingSeconds,
    readingTokens: dailyReadingTokens,
    listeningSeconds: dailyListeningSeconds,
    listeningSentences: dailyListeningSentences,
    speakingOutputs,
    writingOutputs,
    stateMovement: {
      total: Math.max(stateMovementsInRange.total, dailyStateChanges),
      transitions: stateMovementsInRange.transitions,
    },
    coverage: coverageSummary,
    passiveEvidence,
    activeEvidence,
    srsReviews: hasSrsRetentionOutcomeData ? dailySrsReviews : 0,
    srsRetained: hasSrsRetentionOutcomeData ? dailySrsRetained : 0,
    speakingAvailable: options.speakingAvailable ?? speakingOutputs > 0,
    writingAvailable: options.writingAvailable ?? writingOutputs > 0,
    freshness: freshness.status,
    asOf: latestSourceTimestamp,
  };

  const metrics = computeLanguageMetrics(formulaInput);

  // Honest availability states for every section.
  const vocabStatus = deriveAvailability(
    vocabSummary.exactForms.total,
    minSampleSize,
    freshness.status,
    true,
    "no_vocabulary_entries",
  );
  const passiveStatus = deriveAvailability(
    passiveEvidence.count,
    minSampleSize,
    freshness.status,
    true,
    "no_passive_evidence",
  );
  const activeStatus = deriveAvailability(
    activeEvidence.count,
    minSampleSize,
    freshness.status,
    true,
    "no_active_evidence",
  );
  const srsStatus: { status: EvidenceAvailabilityStatus; reason?: string } =
    dailySrsReviews > 0 && !hasSrsRetentionOutcomeData
      ? { status: "unavailable", reason: "retention_outcome_not_recorded" }
      : deriveAvailability(
          dailySrsReviews,
          minSampleSize,
          freshness.status,
          true,
          "no_srs_reviews",
        );
  const overallEvidenceCount = passiveEvidence.count + activeEvidence.count;
  const overallEvidenceStatus = deriveAvailability(
    overallEvidenceCount,
    minSampleSize,
    freshness.status,
    true,
    "no_learning_evidence",
  );
  const lookupStatus = deriveAvailability(
    totalLookupsInRange + lookupRepetitionEntries.length,
    minSampleSize,
    freshness.status,
    true,
    "no_lookup_events",
  );
  const readingStatus = deriveAvailability(
    dailyReadingSessions,
    minSampleSize,
    freshness.status,
    true,
    "no_reading_sessions",
  );
  const listeningStatus = deriveAvailability(
    dailyListeningSessions,
    minSampleSize,
    freshness.status,
    true,
    "no_listening_sessions",
  );
  const practiceStatus = deriveAvailability(
    totalSubmittedAttempts,
    minSampleSize,
    freshness.status,
    true,
    "no_submitted_practice_attempts",
  );

  const coverageAvailability: { status: EvidenceAvailabilityStatus; reason?: string } =
    coverageSummary.readyDocuments >= minSampleSize
      ? { status: coverageSummary.staleDocuments > 0 ? "stale" : "ready" }
      : coverageSummary.pendingDocuments > 0
        ? { status: "pending", reason: "coverage_pending" }
        : coverageSummary.staleDocuments > 0
          ? { status: "stale", reason: "coverage_stale_only" }
          : unavailableOrFailedDocuments > 0
            ? { status: "unavailable", reason: "coverage_unavailable_or_failed" }
            : { status: "insufficient-evidence", reason: "no_ready_coverage_documents" };

  return {
    profileId,
    range: activeRange,
    generatedAt: now,
    freshness,
    metrics,
    vocabulary: {
      status: vocabStatus.status,
      lemmas: vocabSummary.lemmas,
      exactForms: vocabSummary.exactForms,
      activeInRange: {
        lemmas: activeVocabInRange.lemmas,
        exactForms: activeVocabInRange.exactForms,
      },
      stateMovementsInRange: {
        total: Math.max(stateMovementsInRange.total, dailyStateChanges),
        transitions: stateMovementsInRange.transitions,
      },
      ...(vocabStatus.reason ? { reason: vocabStatus.reason } : {}),
    },
    vocabGrowthByDay,
    evidence: {
      status: overallEvidenceStatus.status,
      passive: {
        ...passiveEvidence,
        averageConfidence: metrics["evidence.passive_confidence"]?.value ?? null,
        status: passiveStatus.status,
        ...(passiveStatus.reason ? { reason: passiveStatus.reason } : {}),
      },
      active: {
        ...activeEvidence,
        averageConfidence: metrics["evidence.active_confidence"]?.value ?? null,
        status: activeStatus.status,
        ...(activeStatus.reason ? { reason: activeStatus.reason } : {}),
      },
      srs: {
        reviews: dailySrsReviews,
        retained: dailySrsRetained,
        retentionRate: metrics["srs.retention"]?.value ?? null,
        status: srsStatus.status,
        ...(srsStatus.reason ? { reason: srsStatus.reason } : {}),
      },
      ...(overallEvidenceStatus.reason ? { reason: overallEvidenceStatus.reason } : {}),
    },
    lookups: {
      status: lookupStatus.status,
      totalLookupsInRange,
      lookupsPer1000Words: metrics["lookup.per_1000_words"]?.value ?? null,
      uniqueEntriesLookedUp: lookupRepetitionEntries.length,
      repeatedLookupEntries: repeatedLookupEntries.length,
      repetitionRate,
      totalEncounters: effectiveEncounters,
      averageEncountersPerLemma,
      topRepeatedLookups,
      ...(lookupStatus.reason ? { reason: lookupStatus.reason } : {}),
    },
    activity: {
      reading: {
        status: readingStatus.status,
        sessions: dailyReadingSessions,
        minutes: hasReadingDurationData ? dailyReadingSeconds / 60 : null,
        tokens: hasReadingTokensData ? dailyReadingTokens : null,
        ...(readingStatus.reason ? { reason: readingStatus.reason } : {}),
      },
      listening: {
        status: listeningStatus.status,
        sessions: dailyListeningSessions,
        minutes: hasListeningDurationData ? dailyListeningSeconds / 60 : null,
        sentences: hasListeningSentenceData ? dailyListeningSentences : null,
        ...(listeningStatus.reason ? { reason: listeningStatus.reason } : {}),
      },
      practice: {
        status: practiceStatus.status,
        totalAttempts: attemptsInRange.length,
        submittedAttempts: totalSubmittedAttempts,
        acceptedActiveAttempts: totalAcceptedActiveAttempts,
        averageScore: totalScoreSamples > 0 ? totalScoreSum / totalScoreSamples : null,
        totalErrors,
        errorsByCategory: totalErrorsByCategory,
        byMode: practiceByMode,
        ...(practiceStatus.reason ? { reason: practiceStatus.reason } : {}),
      },
    },
    coverage: {
      status: coverageAvailability.status,
      summary: coverageSummary,
      averageCoverageRatio: metrics["coverage.ratio"]?.value ?? null,
      averageUnknownDensity: metrics["coverage.unknown_density"]?.value ?? null,
      averageDifficultyScore: metrics["difficulty.document_average"]?.value ?? null,
      readyDocuments: coverageSummary.readyDocuments,
      pendingDocuments: coverageSummary.pendingDocuments,
      staleDocuments: coverageSummary.staleDocuments,
      unavailableOrFailedDocuments,
      progression: coverageProgression,
      ...(coverageAvailability.reason ? { reason: coverageAvailability.reason } : {}),
    },
    proficiency: {
      status: "unavailable",
      cefrLevel: null,
      proficiencyScore: null,
      reason: "cefr_certification_not_measured",
    },
  };
}
