/**
 * Deterministic evidence coverage (change
 * `complete-knowledge-relationships-and-coverage`, tasks 1.2–1.4).
 *
 * This is the documented missing path (`src/lib/ai/concepts/coverage.ts`).
 * It answers ONE question — "what does the indexed library contain for this
 * concept?" — with a conservative, versioned rule set. It never models what a
 * user knows, never reads a mastery score, and never lets model rationale or
 * vector similarity raise an evidence level.
 *
 * Ruleset `coverage-v1`:
 *   1. canonical phrase matching uses the same case/whitespace normalization as
 *      Rust `normalize_concept_name` plus token boundaries; aliases count only
 *      when the user explicitly confirmed a same-as link;
 *   2. DIRECT evidence is a current verified mention in card front/answer, an
 *      extract/chunk/annotation with a definition cue for the exact phrase, or
 *      a user-confirmed definition/support relation resolving to actual text;
 *   3. ≥1 direct → `supported`; else ≥1 mention → `partial`;
 *      zero + incomplete/unavailable/unqueried → `unknown`;
 *      zero + provably complete index and successful query → `not-covered`
 *      **by indexed evidence** only;
 *   4. historical activity is orthogonal and cannot change evidence level.
 *
 * The module is split into pure predicates (unit-testable with synthetic text)
 * and `runCoverageAnalysis`, which hydrates every retrieval hit against the
 * real source record before counting it.
 */

import type { ConceptBacklink, Concept } from "../../../api/concept-links";
import {
  findConceptsByNames,
  getConcept,
  getConceptBacklinks,
  getConceptEvidenceAnnotation,
  listConceptLinksFor,
  normalizeConceptName,
} from "../../../api/concept-links";
import type { ChunkLocation, IndexStatusResponse, RetrievalResponse } from "../../../api/ai-learning";
import { getAIIndexStatus, retrieveFromLibrary } from "../../../api/ai-learning";
import { getDocument } from "../../../api/documents";
import { getExtract } from "../../../api/extracts";
import { getLearningItem, type LearningItem } from "../../../api/learning-items";
import { getItemStatsSummary, metricValue } from "../../../api/item-stats";
import type { CardSourceContext } from "../../../api/review";
import { getCardSourceContext } from "../../../api/review";
import type { Document } from "../../../types/document";
import type { Extract } from "../../../api/extracts";

/* ------------------------------------------------------------------------- */
/* Contract                                                                  */
/* ------------------------------------------------------------------------- */

export const COVERAGE_POLICY_VERSION = "coverage-v1";
/** Hard bound on concepts assessed in one analysis (design). */
export const MAX_COVERAGE_CONCEPTS = 12;
/** Retrieval k per concept query (design: k ≤ 6). */
export const COVERAGE_RETRIEVAL_K = 6;
/** Global query concurrency (design: ≤ 2). */
export const COVERAGE_QUERY_CONCURRENCY = 2;
/** Hard bound on evidence candidates considered (12 × 6). */
export const MAX_COVERAGE_EVIDENCE_CANDIDATES = 72;
/** Minimum substantive body after a definition heading. */
export const DEFINITION_HEADING_MIN_CONTENT_CHARS = 60;

export type EvidenceCoverage = "unknown" | "not-covered" | "partial" | "supported";
export type CoverageActivity = "none" | "encountered" | "studied" | "reviewed";
export type IndexCompleteness = "complete" | "partial" | "unavailable";
export type CoverageEvidenceKind = "chunk" | "extract" | "card" | "annotation";
export type CoverageEvidenceStrength = "mention" | "direct";

export type CoverageLocator =
  | {
      kind: "chunk";
      sourceType: string;
      chunkId: string;
      documentId: string;
      ordinal: number;
      startOffset: number;
      endOffset: number;
      pageNumber?: number;
      cfiRange?: string;
      headingPath?: string[];
      timestampMs?: number;
      endTimestampMs?: number;
    }
  | {
      kind: "extract";
      sourceType: string;
      extractId: string;
      documentId: string;
      pageNumber?: number;
      selectionContext?: unknown;
    }
  | {
      kind: "card";
      cardId: string;
      documentId?: string;
      extractId?: string;
      sourceReference?: string | null;
      sourceUrl?: string;
      pageNumber?: number;
      snippet?: string;
    }
  | {
      kind: "annotation";
      sourceType: string;
      annotationId: string;
      documentId: string;
      pageNumber?: number;
    };

export interface CoverageEvidenceRef {
  kind: CoverageEvidenceKind;
  id: string;
  documentId?: string;
  sourceRevision: string;
  locator: CoverageLocator;
  strength: CoverageEvidenceStrength;
  /** Indexed text (already verified against the current source record). */
  text: string;
  /** Display-only title resolved from the current document. */
  documentTitle?: string;
  /** Display-only category, never used by the deterministic rules. */
  category?: "card" | "extract" | "annotation" | "document";
}

export interface ConceptCoverage {
  conceptKey: string;
  conceptName: string;
  evidenceCoverage: EvidenceCoverage;
  activity: CoverageActivity;
  indexCompleteness: IndexCompleteness;
  evidenceRefs: CoverageEvidenceRef[];
  limitations: string[];
}

export interface CoverageAnalysisResult {
  concepts: ConceptCoverage[];
  indexCompleteness: IndexCompleteness;
  limitations: string[];
  /** True when nothing was queried because preflight denied remote work. */
  blocked: boolean;
}

/* ------------------------------------------------------------------------- */
/* Safe limitation keys (content-free)                                        */
/* ------------------------------------------------------------------------- */

export const COVERAGE_LIMITATIONS = {
  indexUnavailable: "coverage.limitation.index-unavailable",
  indexPartial: "coverage.limitation.index-partial",
  auxiliaryFreshnessUnproven: "coverage.limitation.auxiliary-freshness-unproven",
  retrievalFailed: "coverage.limitation.retrieval-failed",
  queryCancelled: "coverage.limitation.query-cancelled",
  remoteDenied: "coverage.limitation.remote-denied",
  remoteEmbeddingConsent: "coverage.limitation.remote-embedding-consent",
  englishCuesOnly: "coverage.limitation.english-cues-only",
  staleSource: "coverage.limitation.stale-source",
  removedSource: "coverage.limitation.removed-source",
  unresolvedHit: "coverage.limitation.unresolved-hit",
  excludedSource: "coverage.limitation.excluded-source",
  historyUnavailable: "coverage.limitation.history-unavailable",
  confirmedLinksUnavailable: "coverage.limitation.confirmed-links-unavailable",
  lexicalOnly: "coverage.limitation.lexical-only",
  noEvidenceBucket: "coverage.limitation.not-covered-by-indexed-evidence",
} as const;

/* ------------------------------------------------------------------------- */
/* Phrase normalization + predicates                                         */
/* ------------------------------------------------------------------------- */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Canonical phrase regex: normalized case-insensitive text where any run of
 * whitespace matches any run of whitespace. Token boundaries use Unicode
 * letters/numbers so "art" never matches inside "part", while punctuation and
 * CJK adjacency still behave predictably.
 */
export function conceptPhrasePattern(phrase: string): RegExp {
  const normalized = normalizeConceptName(phrase);
  const body = normalized
    .split(" ")
    .filter(Boolean)
    .map(escapeRegExp)
    .join("\\s+");
  // Latin-script phrases need token boundaries so "art" never matches inside
  // "part". Scripts without word delimiters (CJK) would otherwise never match
  // their own text; their phrase itself is specific enough.
  const startsLatin = /^[A-Za-z0-9]/.test(normalized);
  const endsLatin = /[A-Za-z0-9]$/.test(normalized);
  const before = startsLatin ? "(?<![\\p{L}\\p{N}])" : "";
  const after = endsLatin ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`${before}${body}${after}`, "iu");
}

/** True when `text` contains the canonical phrase or a confirmed alias. */
export function hasConceptMention(
  text: string,
  phrase: string,
  aliases: readonly string[] = []
): boolean {
  if (!text) return false;
  const candidates = [phrase, ...aliases].filter((value) => value.trim().length > 0);
  return candidates.some((candidate) => conceptPhrasePattern(candidate).test(text));
}

/** Whitespace/case-insensitive phrase occurrence count is intentionally 0/1. */
export function countConceptMentions(
  text: string,
  phrase: string,
  aliases: readonly string[] = []
): number {
  if (!text) return 0;
  let count = 0;
  for (const candidate of [phrase, ...aliases]) {
    const pattern = new RegExp(conceptPhrasePattern(candidate).source, "giu");
    count += [...text.matchAll(pattern)].length;
  }
  return count;
}

const DEFINITION_VERBS = ["is", "means", "refers to"];

/**
 * Definition cue for the exact phrase: `X is`, `X means`, `X refers to`.
 * Case-insensitive and whitespace tolerant, still phrase- and token-bounded.
 */
export function hasInlineDefinitionCue(
  text: string,
  phrase: string,
  aliases: readonly string[] = []
): boolean {
  if (!text) return false;
  for (const candidate of [phrase, ...aliases]) {
    const normalized = normalizeConceptName(candidate);
    if (!normalized) continue;
    const body = normalized
      .split(" ")
      .filter(Boolean)
      .map(escapeRegExp)
      .join("\\s+");
    const startsLatin = /^[A-Za-z0-9]/.test(normalized);
    const before = startsLatin ? "(?<![\\p{L}\\p{N}])" : "";
    for (const verb of DEFINITION_VERBS) {
      const verbPattern = verb.split(" ").map(escapeRegExp).join("\\s+");
      const pattern = new RegExp(
        `${before}${body}\\s+${verbPattern}(?![\\p{L}\\p{N}])`,
        "iu"
      );
      if (pattern.test(text)) return true;
    }
  }
  return false;
}

/** Substantive = at least `min` non-whitespace characters. */
export function isSubstantive(text: string, min = DEFINITION_HEADING_MIN_CONTENT_CHARS): boolean {
  const compact = text.replace(/\s+/gu, "");
  return compact.length >= min;
}

/**
 * A heading exactly naming the concept followed by ≥60 characters of
 * substantive content. Accepts either:
 * - structured `headingPath` entries equal to the phrase, with a substantive
 *   chunk body; or
 * - a text heading line (`# X`, `X`, **X**) immediately followed by a
 *   substantive paragraph.
 */
export function hasDefinitionHeading(
  text: string,
  phrase: string,
  aliases: readonly string[] = [],
  headingPath: readonly string[] = []
): boolean {
  const names = [phrase, ...aliases]
    .map((value) => normalizeConceptName(value))
    .filter(Boolean);

  if (headingPath.some((heading) => names.includes(normalizeConceptName(heading)))) {
    // The heading path already scopes this chunk to the concept; require a
    // substantive body so a bare title cannot become a definition.
    return isSubstantive(text);
  }

  if (!text) return false;
  for (const name of names) {
    const headingPattern = new RegExp(
      `(?:^|\\n)\\s{0,4}(?:#{1,6}\\s*)?${name
        .split(" ")
        .filter(Boolean)
        .map(escapeRegExp)
        .join("\\s+")}\\s*(?:\\n+|$)`,
      "iu"
    );
    const match = headingPattern.exec(text);
    if (!match) continue;
    const rest = text.slice(match.index + match[0].length);
    const firstParagraph = rest.split(/\n\s*\n/u)[0] ?? rest;
    if (isSubstantive(firstParagraph)) return true;
  }
  return false;
}

/** True when the language-specific English cue ruleset cannot apply. */
export function needsNonEnglishCueLimitation(
  concept: string,
  aliases: readonly string[] = []
): boolean {
  const text = [concept, ...aliases].join(" ");
  // Non-Latin scripts (Cyrillic, Hebrew, Arabic, Devanagari, kana, Han,
  // Hangul). English cue verbs are not a safe deterministic signal there.
  return /[\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Hangul}]/u.test(
    text
  );
}

/* ------------------------------------------------------------------------- */
/* Pure state rules                                                          */
/* ------------------------------------------------------------------------- */

/**
 * The exact `coverage-v1` state rule. Exposed pure so the four contract states
 * are directly testable without any I/O.
 */
export function computeEvidenceCoverage(input: {
  refs: readonly Pick<CoverageEvidenceRef, "strength">[];
  indexCompleteness: IndexCompleteness;
  queriesSucceeded: boolean;
}): EvidenceCoverage {
  if (input.refs.some((ref) => ref.strength === "direct")) return "supported";
  if (input.refs.length > 0) return "partial";
  if (input.indexCompleteness === "complete" && input.queriesSucceeded) {
    return "not-covered";
  }
  return "unknown";
}

/**
 * Activity is historical and independent of evidence. The caller supplies
 * *validated* signals derived from real card/extract/reading-history rows:
 * - `reviewed` requires at least one supporting card with a real review event;
 * - `studied` requires a real supporting card or extract;
 * - `encountered` requires a real reading event for a supporting document;
 * - a document merely existing is never `encountered`.
 */
export function computeActivity(input: {
  hasSupportingCard: boolean;
  hasSupportingExtract: boolean;
  reviewedCard: boolean;
  documentEncountered: boolean;
}): CoverageActivity {
  if (input.reviewedCard) return "reviewed";
  if (input.hasSupportingCard || input.hasSupportingExtract) return "studied";
  if (input.documentEncountered) return "encountered";
  return "none";
}

/** Evidence labels are intentionally hedged (never mastery language). */
export function evidenceCoverageLabelKey(level: EvidenceCoverage): string {
  switch (level) {
    case "supported":
      return "coverage.evidence.supported";
    case "partial":
      return "coverage.evidence.partial";
    case "not-covered":
      return "coverage.evidence.notCoveredByIndexedEvidence";
    default:
      return "coverage.evidence.unknown";
  }
}

export function activityLabelKey(activity: CoverageActivity): string {
  switch (activity) {
    case "reviewed":
      return "coverage.activity.reviewed";
    case "studied":
      return "coverage.activity.studied";
    case "encountered":
      return "coverage.activity.encountered";
    default:
      return "coverage.activity.none";
  }
}

/** Hedged English copy used until translations land. */
export function evidenceCoverageText(level: EvidenceCoverage): string {
  switch (level) {
    case "supported":
      return "Supported by identified sources";
    case "partial":
      return "Partial coverage (mentions only)";
    case "not-covered":
      return "Not covered by indexed evidence";
    default:
      return "Unknown (insufficient indexed evidence)";
  }
}

export function activityText(activity: CoverageActivity): string {
  switch (activity) {
    case "reviewed":
      return "Reviewed";
    case "studied":
      return "Studied";
    case "encountered":
      return "Encountered";
    default:
      return "No recorded activity";
  }
}

/** Stable, content-free explanation for a limitation code. */
export function coverageLimitationText(limitation: string): string {
  switch (limitation) {
    case COVERAGE_LIMITATIONS.indexUnavailable:
      return "The library index is unavailable, so this is unknown rather than missing.";
    case COVERAGE_LIMITATIONS.indexPartial:
      return "Part of the library is not indexed yet; absence of evidence is not proof.";
    case COVERAGE_LIMITATIONS.auxiliaryFreshnessUnproven:
      return "Card and annotation freshness cannot be proven from the current index metadata.";
    case COVERAGE_LIMITATIONS.retrievalFailed:
      return "The evidence search failed; coverage is unknown.";
    case COVERAGE_LIMITATIONS.queryCancelled:
      return "The evidence search was cancelled.";
    case COVERAGE_LIMITATIONS.remoteDenied:
      return "Remote processing was not authorized, so no query was sent.";
    case COVERAGE_LIMITATIONS.remoteEmbeddingConsent:
      return "Cloud embedding consent is off, so no remote query was sent.";
    case COVERAGE_LIMITATIONS.englishCuesOnly:
      return "Definition cues currently support English text only; mentions still count.";
    case COVERAGE_LIMITATIONS.staleSource:
      return "A matching source changed; it no longer counts as current evidence.";
    case COVERAGE_LIMITATIONS.removedSource:
      return "A matching source was removed; it no longer counts as current evidence.";
    case COVERAGE_LIMITATIONS.unresolvedHit:
      return "A search hit could not be verified against a current source and was ignored.";
    case COVERAGE_LIMITATIONS.excludedSource:
      return "A source excluded from AI processing was ignored.";
    case COVERAGE_LIMITATIONS.historyUnavailable:
      return "Reading/review history is unavailable; activity is unknown.";
    case COVERAGE_LIMITATIONS.confirmedLinksUnavailable:
      return "Confirmed concept links could not be read.";
    case COVERAGE_LIMITATIONS.lexicalOnly:
      return "Embeddings were unavailable; evidence came from lexical search only.";
    case COVERAGE_LIMITATIONS.noEvidenceBucket:
      return "No supporting evidence was found in the indexed library.";
    default:
      return limitation;
  }
}

/* ------------------------------------------------------------------------- */
/* Hydration contract (injectable; default implementation uses real APIs)     */
/* ------------------------------------------------------------------------- */

/** Narrow annotation projection used for evidence hydration. */
export interface CoverageAnnotationRecord {
  id: string;
  documentId: string;
  content: string;
  pageNumber?: number;
  dateModified: string;
}

export interface CoveragePreflight {
  allowed: boolean;
  /** True when this analysis may send queries/content off-device. */
  remote: boolean;
  limitations: string[];
}

export interface CoverageDependencies {
  retrieve(
    query: string,
    options: {
      k?: number;
      filters?: { documentIds?: string[]; sourceTypes?: string[] };
      includeSpotlight?: boolean;
    }
  ): Promise<RetrievalResponse>;
  getIndexStatus(): Promise<IndexStatusResponse>;
  getDocument(documentId: string): Promise<Document | null>;
  getExtract(extractId: string): Promise<Extract | null>;
  getLearningItem(itemId: string): Promise<LearningItem | null>;
  getAnnotation?(annotationId: string): Promise<CoverageAnnotationRecord | null>;
  getCardSourceContext?(itemId: string): Promise<CardSourceContext | null>;
  getConcept?(conceptId: string): Promise<Concept | null>;
  getItemStatsSummary?(
    itemType: "document" | "extract" | "learning-item",
    itemId: string
  ): Promise<{
    repetitions?: { state?: string; value?: number };
    totalActiveSeconds?: { state?: string; value?: number };
  }>;
  getConceptBacklinks?(conceptId: string): Promise<ConceptBacklink[]>;
  listConceptLinksFor?(kind: string, id: string): Promise<ConceptBacklink[]>;
  findConceptsByNames?(names: string[]): Promise<Concept[]>;
  /** Called before any query. Default checks embedding destination consent. */
  preflight?(): Promise<CoveragePreflight>;
}

function abortError(): Error {
  const error = new Error("coverage analysis cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Bounded worker pool: at most `concurrency` jobs in flight, order preserved. */
async function boundedMap<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Verify that indexed text still exists in the current source record. */
export function sourceStillContains(haystack: string, needle: string): boolean {
  if (!needle.trim()) return false;
  const normalizedHaystack = collapseWhitespace(haystack);
  const normalizedNeedle = collapseWhitespace(needle);
  return normalizedHaystack.includes(normalizedNeedle);
}

function sourceRevisionForDocument(doc: Document): string {
  return doc.contentHash && doc.contentHash.trim()
    ? doc.contentHash
    : doc.dateModified || "unknown";
}

function sourceRevisionForRecord(record: { date_modified?: string; dateModified?: string }): string {
  return record.date_modified || record.dateModified || "unknown";
}

function mapHitLocator(hit: RetrievalResponse["results"][number]): CoverageLocator {
  const location: ChunkLocation = hit.location;
  return {
    kind: "chunk",
    sourceType: String(location?.sourceType ?? "text"),
    chunkId: hit.chunkId,
    documentId: hit.documentId,
    ordinal: hit.ordinal,
    startOffset: location?.startOffset ?? 0,
    endOffset: location?.endOffset ?? 0,
    pageNumber: location?.pageNumber,
    cfiRange: location?.cfiRange,
    headingPath: hit.headingPath,
    timestampMs: location?.timestampMs,
    endTimestampMs: location?.endTimestampMs,
  };
}

/* ------------------------------------------------------------------------- */
/* Index completeness                                                        */
/* ------------------------------------------------------------------------- */

export interface CoverageScope {
  /** Restricts retrieval to these documents (authorization boundary). */
  documentIds?: string[];
  /**
   * Whether the declared search scope includes extract/card/annotation
   * chunks. When true (the default), index completeness can never be
   * `complete` because existing status metadata cannot prove auxiliary-source
   * freshness. Zero hits therefore stay `unknown`, never `not-covered`.
   */
  includeAuxiliarySources?: boolean;
}

export function computeIndexCompleteness(
  status: IndexStatusResponse | null,
  scope: CoverageScope = {}
): { completeness: IndexCompleteness; limitations: string[] } {
  const limitations: string[] = [];
  if (!status) {
    return {
      completeness: "unavailable",
      limitations: [COVERAGE_LIMITATIONS.indexUnavailable],
    };
  }

  const documents = (status.documents ?? []).filter((doc) =>
    scope.documentIds && scope.documentIds.length > 0
      ? scope.documentIds.includes(doc.documentId)
      : true
  );
  if ((status.documents ?? []).length >= 500) {
    // The backend status projection is bounded; a full library cannot be
    // proven complete from a truncated list.
    limitations.push(COVERAGE_LIMITATIONS.indexPartial);
    return { completeness: "partial", limitations };
  }

  if (documents.length === 0) {
    limitations.push(COVERAGE_LIMITATIONS.indexUnavailable);
    return { completeness: "unavailable", limitations };
  }
  if (
    scope.documentIds &&
    scope.documentIds.length > 0 &&
    documents.length < scope.documentIds.length
  ) {
    // A document in the declared scope has no index state row at all; the
    // scope is not provably complete.
    limitations.push(COVERAGE_LIMITATIONS.indexPartial);
    return { completeness: "partial", limitations };
  }

  const usable = documents.filter(
    (doc) => doc.state !== "unindexed" && doc.state !== "failed"
  );
  if (usable.length === 0) {
    limitations.push(COVERAGE_LIMITATIONS.indexUnavailable);
    return { completeness: "unavailable", limitations };
  }

  const documentScopeComplete = documents.every(
    (doc) =>
      doc.state === "indexed" &&
      (doc.totalChunks <= 0 || doc.chunksIndexed >= doc.totalChunks)
  );
  if (!documentScopeComplete) {
    limitations.push(COVERAGE_LIMITATIONS.indexPartial);
    return { completeness: "partial", limitations };
  }

  if (scope.includeAuxiliarySources !== false) {
    // Document rows prove the last indexing pass, not that every card /
    // extract / annotation modified afterwards is current. Honest partial.
    limitations.push(COVERAGE_LIMITATIONS.indexPartial);
    limitations.push(COVERAGE_LIMITATIONS.auxiliaryFreshnessUnproven);
    return { completeness: "partial", limitations };
  }

  return { completeness: "complete", limitations };
}

/* ------------------------------------------------------------------------- */
/* Default dependencies                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Embedding destination preflight. It only blocks when the persisted settings
 * provide positive evidence that an embedding query would leave the device:
 * a remote Ollama endpoint, or a billable provider with explicit paid-embedding
 * consent. Default lexical-only retrieval is never blocked. Generation
 * disclosure is checked separately by the analysis owner.
 */
export async function defaultCoveragePreflight(): Promise<CoveragePreflight> {
  const limitations: string[] = [];
  try {
    const [{ useSettingsStore }, { classifyEmbeddingDestination }, disclosure] =
      await Promise.all([
        import("../../../stores/settingsStore"),
        import("../features/destinations"),
        import("../../privacy/cloudAiDisclosure"),
      ]);
    const embedding = useSettingsStore.getState().settings.embedding;
    const destination = classifyEmbeddingDestination({
      provider: embedding.provider,
      ollamaBaseUrl: embedding.ollamaBaseUrl,
    });
    const potentiallyRemote =
      destination.sendsOffDevice &&
      (embedding.provider === "ollama" || embedding.paidEmbeddingsEnabled === true);
    if (!potentiallyRemote) return { allowed: true, remote: false, limitations };

    if (embedding.provider !== "ollama" && embedding.paidEmbeddingsEnabled !== true) {
      limitations.push(COVERAGE_LIMITATIONS.remoteEmbeddingConsent);
      return { allowed: false, remote: true, limitations };
    }

    const disclosed = await disclosure.ensureCloudAiDisclosure({
      featureClass: "embeddings",
      provider: embedding.provider,
      isLocal: false,
    });
    if (!disclosed) {
      limitations.push(COVERAGE_LIMITATIONS.remoteDenied);
      return { allowed: false, remote: true, limitations };
    }
    return { allowed: true, remote: true, limitations };
  } catch {
    // A probe failure is not permission to transmit: fail closed for unknown
    // destinations by running no query rather than guessing.
    limitations.push(COVERAGE_LIMITATIONS.remoteDenied);
    return { allowed: false, remote: true, limitations };
  }
}

export function defaultCoverageDependencies(): CoverageDependencies {
  return {
    retrieve: (query, options) =>
      retrieveFromLibrary(query, {
        k: options.k,
        filters: options.filters as never,
        includeSpotlight: false,
      }),
    getIndexStatus: () => getAIIndexStatus(),
    getDocument: (documentId) => getDocument(documentId),
    getExtract: (extractId) => getExtract(extractId),
    getLearningItem: (itemId) => getLearningItem(itemId),
    getAnnotation: (annotationId) => getConceptEvidenceAnnotation(annotationId),
    getCardSourceContext: (itemId) => getCardSourceContext(itemId),
    getConcept: (conceptId) => getConcept(conceptId),
    getItemStatsSummary: (itemType, itemId) => getItemStatsSummary(itemType, itemId),
    getConceptBacklinks: (conceptId) => getConceptBacklinks(conceptId),
    listConceptLinksFor: (kind, id) =>
      listConceptLinksFor(kind, id, false) as unknown as Promise<ConceptBacklink[]>,
    findConceptsByNames: (names) => findConceptsByNames(names),
    preflight: defaultCoveragePreflight,
  };
}

/* ------------------------------------------------------------------------- */
/* Orchestrator                                                              */
/* ------------------------------------------------------------------------- */

export interface CoverageConceptInput {
  name: string;
  why?: string;
  /** Existing concept id when the caller already resolved it read-only. */
  conceptId?: string;
  /** Explicit user-confirmed aliases only (never model synonyms). */
  aliases?: string[];
}

interface CoverageRunContext {
  deps: CoverageDependencies;
  scope: CoverageScope;
  remoteQuery: boolean;
  signal?: AbortSignal;
  indexCompleteness: IndexCompleteness;
  indexLimitations: string[];
  documentCache: Map<string, Document | null>;
  candidateBudget: { remaining: number };
}

interface ConceptRunContext {
  concept: CoverageConceptInput;
  conceptKey: string;
  aliases: string[];
  existingConceptId?: string;
}

function takeCandidate(budget: { remaining: number }): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
}

async function getCachedDocument(
  ctx: CoverageRunContext,
  documentId: string
): Promise<Document | null> {
  if (ctx.documentCache.has(documentId)) return ctx.documentCache.get(documentId) ?? null;
  const doc = await ctx.deps.getDocument(documentId).catch(() => null);
  ctx.documentCache.set(documentId, doc);
  return doc;
}

function documentAllowed(ctx: CoverageRunContext, doc: Document): boolean {
  if (doc.isAiExcluded === true) return false;
  if (ctx.remoteQuery && doc.isLocalOnly === true) return false;
  if (ctx.scope.documentIds && ctx.scope.documentIds.length > 0) {
    return ctx.scope.documentIds.includes(doc.id);
  }
  return true;
}

function strengthFor(
  kind: CoverageEvidenceKind,
  text: string,
  concept: string,
  aliases: string[],
  headingPath: readonly string[]
): CoverageEvidenceStrength | null {
  if (!hasConceptMention(text, concept, aliases)) return null;
  // Rule 2: a current verified mention in a card front/answer is direct.
  if (kind === "card") return "direct";
  if (hasInlineDefinitionCue(text, concept, aliases)) return "direct";
  if (hasDefinitionHeading(text, concept, aliases, headingPath)) return "direct";
  return "mention";
}

async function hydrateRetrievalHit(
  ctx: CoverageRunContext,
  run: ConceptRunContext,
  hit: RetrievalResponse["results"][number]
): Promise<CoverageEvidenceRef | null> {
  const doc = await getCachedDocument(ctx, hit.documentId);
  if (!doc) return null;
  if (!documentAllowed(ctx, doc)) return null;

  const sourceType = String(hit.sourceType ?? "document");
  const base = {
    documentId: hit.documentId,
    documentTitle: doc.title,
  } as const;

  if (sourceType === "document" || sourceType === "transcript") {
    const text = hit.text ?? "";
    if (!sourceStillContains(doc.content ?? "", text)) return null;
    const strength = strengthFor("chunk", text, run.concept.name, run.aliases, hit.headingPath ?? []);
    if (!strength) return null;
    return {
      kind: "chunk",
      id: hit.chunkId,
      ...base,
      sourceRevision: sourceRevisionForDocument(doc),
      locator: mapHitLocator(hit),
      strength,
      text,
      category: "document",
    };
  }

  if (sourceType === "extract") {
    if (!hit.sourceId || !ctx.deps.getExtract) return null;
    const extract = await ctx.deps.getExtract(hit.sourceId).catch(() => null);
    if (!extract) return null;
    if (extract.document_id !== hit.documentId) return null;
    if (!sourceStillContains(extract.content ?? "", hit.text ?? "")) return null;
    const strength = strengthFor(
      "extract",
      extract.content ?? "",
      run.concept.name,
      run.aliases,
      hit.headingPath ?? []
    );
    if (!strength) return null;
    return {
      kind: "extract",
      id: extract.id,
      ...base,
      sourceRevision: sourceRevisionForRecord(extract),
      locator: {
        kind: "extract",
        sourceType: String(hit.location?.sourceType ?? "text"),
        extractId: extract.id,
        documentId: extract.document_id,
        pageNumber: extract.page_number,
        selectionContext: extract.selection_context,
      },
      strength,
      text: extract.content ?? hit.text ?? "",
      category: "extract",
    };
  }

  if (sourceType === "card") {
    if (!hit.sourceId || !ctx.deps.getLearningItem) return null;
    const card = await ctx.deps.getLearningItem(hit.sourceId).catch(() => null);
    if (!card) return null;
    if (card.document_id && card.document_id !== hit.documentId) return null;
    const cardText = [card.question, card.answer ?? "", card.cloze_text ?? ""]
      .filter(Boolean)
      .join("\n");
    if (!sourceStillContains(cardText, hit.text ?? "")) return null;
    const strength = strengthFor("card", cardText, run.concept.name, run.aliases, []);
    if (!strength) return null;
    const sourceContext = ctx.deps.getCardSourceContext
      ? await ctx.deps.getCardSourceContext(card.id).catch(() => null)
      : null;
    return {
      kind: "card",
      id: card.id,
      ...base,
      sourceRevision: sourceRevisionForRecord(card),
      locator: {
        kind: "card",
        cardId: card.id,
        documentId: card.document_id ?? undefined,
        extractId: card.extract_id,
        sourceReference: card.source_reference ?? null,
        sourceUrl: sourceContext?.source_url,
        pageNumber: sourceContext?.page_number,
        snippet: sourceContext?.extract_snippet,
      },
      strength,
      text: cardText,
      category: "card",
    };
  }

  if (sourceType === "annotation") {
    if (!hit.sourceId || !ctx.deps.getAnnotation) return null;
    const annotation = await ctx.deps.getAnnotation(hit.sourceId).catch(() => null);
    if (!annotation) return null;
    if (annotation.documentId !== hit.documentId) return null;
    if (!sourceStillContains(annotation.content ?? "", hit.text ?? "")) return null;
    const strength = strengthFor(
      "annotation",
      annotation.content ?? "",
      run.concept.name,
      run.aliases,
      hit.headingPath ?? []
    );
    if (!strength) return null;
    return {
      kind: "annotation",
      id: annotation.id,
      ...base,
      sourceRevision: sourceRevisionForRecord(annotation),
      locator: {
        kind: "annotation",
        sourceType: String(hit.location?.sourceType ?? "text"),
        annotationId: annotation.id,
        documentId: annotation.documentId,
        pageNumber: annotation.pageNumber,
      },
      strength,
      text: annotation.content ?? hit.text ?? "",
      category: "annotation",
    };
  }

  // figure/media/other indexed artifacts are not part of the evidence
  // contract; similarity alone must not count.
  return null;
}

function dedupeRefs(refs: CoverageEvidenceRef[]): CoverageEvidenceRef[] {
  const byKey = new Map<string, CoverageEvidenceRef>();
  for (const ref of refs) {
    const key = `${ref.kind}\u0000${ref.id}`;
    const existing = byKey.get(key);
    if (!existing || (existing.strength === "mention" && ref.strength === "direct")) {
      byKey.set(key, ref);
    }
  }
  return [...byKey.values()];
}

async function computeConceptActivity(
  ctx: CoverageRunContext,
  refs: readonly CoverageEvidenceRef[]
): Promise<{ activity: CoverageActivity; limitations: string[] }> {
  const limitations: string[] = [];
  const cards = refs.filter((ref) => ref.kind === "card");
  const extracts = refs.filter((ref) => ref.kind === "extract");
  const documents = new Set<string>();
  for (const ref of refs) if (ref.documentId) documents.add(ref.documentId);

  let reviewedCard = false;
  if (ctx.deps.getItemStatsSummary) {
    for (const card of cards) {
      try {
        const summary = await ctx.deps.getItemStatsSummary("learning-item", card.id);
        if (Number(metricValue(summary.repetitions as never) ?? 0) > 0) {
          reviewedCard = true;
          break;
        }
      } catch {
        limitations.push(COVERAGE_LIMITATIONS.historyUnavailable);
      }
    }
  } else if (cards.length > 0) {
    limitations.push(COVERAGE_LIMITATIONS.historyUnavailable);
  }

  let documentEncountered = false;
  if (ctx.deps.getItemStatsSummary && !reviewedCard) {
    for (const documentId of documents) {
      try {
        const summary = await ctx.deps.getItemStatsSummary("document", documentId);
        const sessions = Number(metricValue(summary.repetitions as never) ?? 0);
        const seconds = Number(metricValue(summary.totalActiveSeconds as never) ?? 0);
        if (sessions > 0 || seconds > 0) {
          documentEncountered = true;
          break;
        }
      } catch {
        limitations.push(COVERAGE_LIMITATIONS.historyUnavailable);
      }
    }
  }

  return {
    activity: computeActivity({
      hasSupportingCard: cards.length > 0,
      hasSupportingExtract: extracts.length > 0,
      reviewedCard,
      documentEncountered,
    }),
    limitations,
  };
}

async function hydrateConfirmedLinkSource(
  ctx: CoverageRunContext,
  run: ConceptRunContext,
  link: ConceptBacklink
): Promise<CoverageEvidenceRef | null> {
  const sourceKind = link.sourceKind;
  const sourceId = link.sourceId;
  const relation = link.relationType;
  if (relation !== "definition-of" && relation !== "supports") return null;
  if (link.createdBy !== "user" || link.isDismissed) return null;
  if (sourceKind === "concept" || sourceKind === "chunk") return null;

  const docId =
    sourceKind === "extract"
      ? (await ctx.deps.getExtract?.(sourceId).catch(() => null))?.document_id
      : sourceKind === "card"
        ? (await ctx.deps.getLearningItem?.(sourceId).catch(() => null))?.document_id
        : sourceKind === "annotation"
          ? (await ctx.deps.getAnnotation?.(sourceId).catch(() => null))?.documentId
          : sourceKind === "document"
            ? sourceId
            : undefined;
  if (!docId) return null;
  const doc = await getCachedDocument(ctx, docId);
  if (!doc || !documentAllowed(ctx, doc)) return null;
  const expectedRevision = link.sourceRevision?.trim() || null;

  if (sourceKind === "document") {
    const text = doc.content ?? "";
    if (!hasConceptMention(text, run.concept.name, run.aliases)) return null;
    const revision = sourceRevisionForDocument(doc);
    if (expectedRevision && expectedRevision !== revision) return null;
    return {
      kind: "chunk",
      id: `concept-link:${link.id}`,
      documentId: doc.id,
      documentTitle: doc.title,
      sourceRevision: revision,
      locator: {
        kind: "chunk",
        sourceType: doc.fileType,
        chunkId: `concept-link:${link.id}`,
        documentId: doc.id,
        ordinal: 0,
        startOffset: 0,
        endOffset: 0,
      },
      strength: "direct",
      text,
      category: "document",
    };
  }

  if (sourceKind === "extract") {
    const extract = await ctx.deps.getExtract?.(sourceId).catch(() => null);
    if (!extract) return null;
    if (!hasConceptMention(extract.content ?? "", run.concept.name, run.aliases)) return null;
    const revision = sourceRevisionForRecord(extract);
    if (expectedRevision && expectedRevision !== revision) return null;
    return {
      kind: "extract",
      id: extract.id,
      documentId: extract.document_id,
      documentTitle: doc.title,
      sourceRevision: revision,
      locator: {
        kind: "extract",
        sourceType: doc.fileType,
        extractId: extract.id,
        documentId: extract.document_id,
        pageNumber: extract.page_number,
      },
      strength: "direct",
      text: extract.content ?? "",
      category: "extract",
    };
  }

  if (sourceKind === "card") {
    const card = await ctx.deps.getLearningItem?.(sourceId).catch(() => null);
    if (!card) return null;
    const cardText = [card.question, card.answer ?? "", card.cloze_text ?? ""]
      .filter(Boolean)
      .join("\n");
    if (!hasConceptMention(cardText, run.concept.name, run.aliases)) return null;
    const revision = sourceRevisionForRecord(card);
    if (expectedRevision && expectedRevision !== revision) return null;
    return {
      kind: "card",
      id: card.id,
      documentId: card.document_id,
      documentTitle: doc.title,
      sourceRevision: revision,
      locator: {
        kind: "card",
        cardId: card.id,
        documentId: card.document_id,
        extractId: card.extract_id,
        sourceReference: card.source_reference ?? null,
      },
      strength: "direct",
      text: cardText,
      category: "card",
    };
  }

  if (sourceKind === "annotation") {
    const annotation = await ctx.deps.getAnnotation?.(sourceId).catch(() => null);
    if (!annotation) return null;
    if (!hasConceptMention(annotation.content ?? "", run.concept.name, run.aliases)) return null;
    const revision = sourceRevisionForRecord(annotation);
    if (expectedRevision && expectedRevision !== revision) return null;
    return {
      kind: "annotation",
      id: annotation.id,
      documentId: annotation.documentId,
      documentTitle: doc.title,
      sourceRevision: revision,
      locator: {
        kind: "annotation",
        sourceType: doc.fileType,
        annotationId: annotation.id,
        documentId: annotation.documentId,
        pageNumber: annotation.pageNumber,
      },
      strength: "direct",
      text: annotation.content ?? "",
      category: "annotation",
    };
  }

  return null;
}

async function collectConfirmedLinkEvidence(
  ctx: CoverageRunContext,
  run: ConceptRunContext
): Promise<{ aliases: string[]; refs: CoverageEvidenceRef[]; limitations: string[] }> {
  const aliases: string[] = [];
  const refs: CoverageEvidenceRef[] = [];
  const limitations: string[] = [];
  if (!run.existingConceptId) return { aliases, refs, limitations };

  let incoming: ConceptBacklink[] = [];
  let outgoing: ConceptBacklink[] = [];
  try {
    if (ctx.deps.getConceptBacklinks) {
      incoming = await ctx.deps.getConceptBacklinks(run.existingConceptId);
    }
    if (ctx.deps.listConceptLinksFor) {
      outgoing = await ctx.deps.listConceptLinksFor("concept", run.existingConceptId);
    }
  } catch {
    limitations.push(COVERAGE_LIMITATIONS.confirmedLinksUnavailable);
    return { aliases, refs, limitations };
  }

  const aliasKeys = new Set<string>([run.conceptKey]);
  for (const link of incoming) {
    if (
      link.createdBy === "user" &&
      !link.isDismissed &&
      link.relationType === "same-as" &&
      link.sourceKind === "concept" &&
      link.sourceConceptName
    ) {
      const key = normalizeConceptName(link.sourceConceptName);
      if (key && !aliasKeys.has(key) && aliases.length < 8) {
        aliasKeys.add(key);
        aliases.push(link.sourceConceptName);
      }
    }
  }

  for (const link of outgoing) {
    if (link.createdBy !== "user" || link.isDismissed) continue;
    if (link.relationType !== "same-as" || link.targetKind !== "concept") continue;
    if (!ctx.deps.getConcept) continue;
    const target = await ctx.deps.getConcept(link.targetId).catch(() => null);
    if (!target) continue;
    const key = normalizeConceptName(target.name);
    if (key && !aliasKeys.has(key) && aliases.length < 8) {
      aliasKeys.add(key);
      aliases.push(target.name);
    }
  }

  const runWithAliases: ConceptRunContext = { ...run, aliases };
  for (const link of incoming) {
    if (link.relationType !== "definition-of" && link.relationType !== "supports") continue;
    if (!takeCandidate(ctx.candidateBudget)) continue;
    const ref = await hydrateConfirmedLinkSource(ctx, runWithAliases, link);
    if (ref) refs.push(ref);
  }

  return { aliases, refs, limitations };
}

function uniqueLimitations(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Assess deterministic coverage for up to twelve concepts.
 *
 * Coverage-only inspection persists nothing: this function uses read APIs and
 * shared retrieval only. The caller owns any explicit save/accept transaction.
 */
export async function runCoverageAnalysis(input: {
  concepts: readonly CoverageConceptInput[];
  scope?: CoverageScope;
  signal?: AbortSignal;
  dependencies?: Partial<CoverageDependencies>;
  /** Pre-computed preflight from the analysis owner (avoids double prompting). */
  preflight?: CoveragePreflight;
}): Promise<CoverageAnalysisResult> {
  const deps: CoverageDependencies = {
    ...defaultCoverageDependencies(),
    ...(input.dependencies ?? {}),
  };
  const scope: CoverageScope = { ...(input.scope ?? {}) };
  throwIfAborted(input.signal);

  const preflight =
    input.preflight ??
    (deps.preflight
      ? await deps.preflight()
      : { allowed: true, remote: false, limitations: [] });

  // Case/whitespace variants share one canonical result; synonyms are NEVER
  // merged here (explicit aliases come only from user-confirmed same-as links).
  const seen = new Set<string>();
  const concepts: CoverageConceptInput[] = [];
  for (const raw of input.concepts) {
    const name = raw.name.trim();
    if (!name) continue;
    const key = normalizeConceptName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    concepts.push(raw);
    if (concepts.length >= MAX_COVERAGE_CONCEPTS) break;
  }

  if (concepts.length === 0) {
    return {
      concepts: [],
      indexCompleteness: "unavailable",
      limitations: [],
      blocked: false,
    };
  }

  if (!preflight.allowed) {
    const limitations = uniqueLimitations([
      COVERAGE_LIMITATIONS.remoteDenied,
      ...preflight.limitations,
      COVERAGE_LIMITATIONS.indexUnavailable,
    ]);
    return {
      concepts: concepts.map((concept) => ({
        conceptKey: normalizeConceptName(concept.name),
        conceptName: concept.name,
        evidenceCoverage: "unknown" as const,
        activity: "none" as const,
        indexCompleteness: "unavailable" as const,
        evidenceRefs: [],
        limitations,
      })),
      indexCompleteness: "unavailable",
      limitations,
      blocked: true,
    };
  }

  const status = await deps.getIndexStatus().catch(() => null);
  const index = computeIndexCompleteness(status, scope);

  const resolvedConcepts = deps.findConceptsByNames
    ? await deps
        .findConceptsByNames(concepts.map((concept) => concept.name))
        .catch(() => [] as Concept[])
    : [];
  const resolvedByKey = new Map<string, Concept>();
  for (const concept of resolvedConcepts) {
    resolvedByKey.set(normalizeConceptName(concept.name), concept);
  }

  const ctx: CoverageRunContext = {
    deps,
    scope,
    remoteQuery: preflight.remote,
    signal: input.signal,
    indexCompleteness: index.completeness,
    indexLimitations: index.limitations,
    documentCache: new Map(),
    candidateBudget: { remaining: MAX_COVERAGE_EVIDENCE_CANDIDATES },
  };

  const runs: ConceptRunContext[] = concepts.map((concept) => {
    const key = normalizeConceptName(concept.name);
    return {
      concept,
      conceptKey: key,
      aliases: (concept.aliases ?? []).filter((alias) => normalizeConceptName(alias) !== key),
      existingConceptId: concept.conceptId ?? resolvedByKey.get(key)?.id,
    };
  });

  const assessed = await boundedMap(runs, COVERAGE_QUERY_CONCURRENCY, async (run) => {
    throwIfAborted(input.signal);
    const linkResult = await collectConfirmedLinkEvidence(ctx, run);
    const aliases = [...run.aliases, ...linkResult.aliases];
    const runWithAliases: ConceptRunContext = { ...run, aliases };

    let refs: CoverageEvidenceRef[] = [...linkResult.refs];
    let querySucceeded = true;
    const limitations: string[] = [...linkResult.limitations];

    try {
      const response = await deps.retrieve(run.conceptKey, {
        k: COVERAGE_RETRIEVAL_K,
        filters: {
          documentIds: scope.documentIds,
          sourceTypes: ["document", "extract", "annotation", "card"],
        },
        includeSpotlight: false,
      });
      throwIfAborted(input.signal);
      if (response.mode === "lexicalOnly") {
        limitations.push(COVERAGE_LIMITATIONS.lexicalOnly);
      }
      let hydratedCount = 0;
      for (const hit of response.results.slice(0, COVERAGE_RETRIEVAL_K)) {
        throwIfAborted(input.signal);
        if (!takeCandidate(ctx.candidateBudget)) continue;
        const ref = await hydrateRetrievalHit(ctx, runWithAliases, hit);
        if (ref) {
          refs.push(ref);
          hydratedCount += 1;
        }
      }
      if (response.results.length > hydratedCount) {
        limitations.push(COVERAGE_LIMITATIONS.unresolvedHit);
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      querySucceeded = false;
      limitations.push(COVERAGE_LIMITATIONS.retrievalFailed);
    }

    throwIfAborted(input.signal);
    refs = dedupeRefs(refs).slice(0, MAX_COVERAGE_EVIDENCE_CANDIDATES);
    const activity = await computeConceptActivity(ctx, refs);
    limitations.push(...activity.limitations);
    if (needsNonEnglishCueLimitation(run.concept.name, aliases)) {
      limitations.push(COVERAGE_LIMITATIONS.englishCuesOnly);
    }
    if (refs.length === 0 && index.completeness !== "complete") {
      limitations.push(...index.limitations);
    }

    const evidenceCoverage = computeEvidenceCoverage({
      refs,
      indexCompleteness: index.completeness,
      queriesSucceeded: querySucceeded,
    });

    return {
      conceptKey: run.conceptKey,
      conceptName: run.concept.name,
      evidenceCoverage,
      activity: activity.activity,
      indexCompleteness: index.completeness,
      evidenceRefs: refs,
      limitations: uniqueLimitations(limitations),
    } satisfies ConceptCoverage;
  });

  const resultLimitations = uniqueLimitations([
    ...index.limitations,
    ...assessed.flatMap((concept) => concept.limitations),
  ]);

  return {
    concepts: assessed,
    indexCompleteness: index.completeness,
    limitations: resultLimitations,
    blocked: false,
  };
}
