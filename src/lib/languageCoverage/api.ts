import {
  getLanguageCoverageResults,
  upsertLanguageCoverageResult,
  type LanguageCoverageResultRecord,
} from "../../api/languageEcosystem";
import type { LanguageKnowledgeStateSnapshot } from "../../types/languageKnowledge";
import type { LanguageLexicalEntry } from "../../types/languageLexicon";
import { canonicalStableJson, digestText128 } from "../languageProcessing/fingerprints";
import type { AnalysisChunk, LanguageAnalysisResult } from "../languageProcessing/types";
import { calculateCoverage } from "./calculator";
import { coverageReverseIndex, type CoverageReverseIndex } from "./invalidation";
import {
  DEFAULT_COVERAGE_POLICY,
  type CoverageCalculationResult,
  type CoverageChunkInput,
  type CoverageChunkReference,
  type CoverageDetail,
  type CoverageDocumentInput,
  type CoverageFreshness,
  type CoveragePhraseCandidate,
  type CoverageProjection,
  type CoverageSummary,
  type CoverageTokenInput,
  type CoverageVersion,
  type InputKnowledgeState,
  type LexicalCoveragePolicy,
} from "./types";

/** Pure adapters keep pending/stale coverage distinct from a measured zero. */
export function coverageSummary(
  projection: CoverageProjection | CoverageCalculationResult,
): CoverageSummary | undefined {
  if ("summary" in projection && projection.summary?.freshness === "fresh") return projection.summary;
  return undefined;
}

export function coverageDetail(
  projection: CoverageProjection | CoverageCalculationResult,
  calculation?: CoverageCalculationResult,
): CoverageDetail {
  if ("chunks" in projection && "summary" in projection) {
    return {
      freshness: projection.summary.freshness,
      version: projection.version,
      summary: projection.summary,
      chunks: projection.chunks,
      units: projection.chunks.flatMap((chunk) => chunk.units),
    };
  }
  return {
    freshness: projection.freshness,
    version: projection.version,
    summary: projection.summary,
    chunks: calculation?.chunks ?? [],
    units: calculation?.chunks.flatMap((chunk) => chunk.units) ?? [],
    error: projection.error,
  };
}

export function coverageDisplayState(projection: CoverageProjection): {
  freshness: CoverageProjection["freshness"];
  coveragePercent?: number;
  uniqueKnownPercent?: number;
  difficultyLabel?: string;
  message: string;
} {
  if (!projection.summary || projection.freshness !== "fresh" || projection.summary.freshness !== "fresh") {
    return { freshness: projection.freshness, message: projection.freshness };
  }
  return {
    freshness: "fresh",
    coveragePercent: projection.summary.coveragePercent,
    uniqueKnownPercent: projection.summary.uniqueKnownPercent,
    difficultyLabel: projection.summary.difficultyLabel,
    message: "fresh",
  };
}

export function createUnavailableCoverageProjection(
  version: CoverageVersion,
  freshness: Exclude<CoverageFreshness, "fresh"> = "unavailable",
  error?: string,
): CoverageProjection {
  return {
    freshness,
    version,
    error,
  };
}

export function projectionFromCoverageRecord(
  record: LanguageCoverageResultRecord | null | undefined,
  fallbackVersion: CoverageVersion,
): CoverageProjection {
  if (!record) {
    return createUnavailableCoverageProjection(fallbackVersion, "unavailable");
  }
  const version: CoverageVersion = {
    contractVersion: fallbackVersion.contractVersion,
    documentId: record.documentId,
    profileId: record.profileId,
    languageTag: fallbackVersion.languageTag,
    contentFingerprint: record.contentFingerprint,
    processorVersion: record.processorVersion,
    lexiconStateVersion: record.lexiconStateVersion,
    policyVersion: record.policyVersion,
    thresholdVersion: record.thresholdVersion,
    coverageKey: record.coverageKey,
  };
  if (record.freshness !== "fresh" || !record.summary) {
    return {
      freshness: record.freshness,
      version,
      error: record.error,
      updatedAt: record.updatedAt,
    };
  }
  const summary = record.summary as unknown as CoverageSummary;
  if (summary.freshness !== "fresh") {
    return {
      freshness: summary.freshness ?? "unavailable",
      version,
      error: record.error,
      updatedAt: record.updatedAt,
    };
  }
  return {
    freshness: "fresh",
    version,
    summary,
    updatedAt: record.updatedAt,
  };
}

export type ProfileKnowledgeStatesInput =
  | readonly LanguageKnowledgeStateSnapshot[]
  | ReadonlyMap<string, InputKnowledgeState>
  | Readonly<Record<string, InputKnowledgeState>>;

export interface SaveAndComputeDocumentCoverageInput {
  documentId: string;
  profileId: string;
  analysis: LanguageAnalysisResult;
  lexiconEntries?: readonly LanguageLexicalEntry[];
  knowledgeStates?: ProfileKnowledgeStatesInput;
  lexiconStateVersion?: string;
  policy?: LexicalCoveragePolicy;
  thresholdVersion?: string;
  reverseIndex?: CoverageReverseIndex;
  persistResult?: typeof upsertLanguageCoverageResult;
  now?: () => number;
}

function buildStateMap(
  profileId: string,
  entries: readonly LanguageLexicalEntry[],
  knowledgeStates?: ProfileKnowledgeStatesInput,
): Map<string, InputKnowledgeState> {
  const stateByEntryId = new Map<string, InputKnowledgeState>();
  for (const entry of entries) {
    if (entry.profileId !== profileId) continue;
    if (entry.knowledgeState) {
      stateByEntryId.set(entry.id, entry.knowledgeState as InputKnowledgeState);
    }
  }
  if (!knowledgeStates) return stateByEntryId;
  if (Array.isArray(knowledgeStates)) {
    for (const snapshot of knowledgeStates) {
      if (snapshot.profileId === profileId) {
        stateByEntryId.set(snapshot.lexicalEntryId, snapshot.state);
      }
    }
    return stateByEntryId;
  }
  if (knowledgeStates instanceof Map) {
    for (const [entryId, state] of knowledgeStates.entries()) {
      stateByEntryId.set(entryId, state);
    }
    return stateByEntryId;
  }
  for (const [entryId, state] of Object.entries(knowledgeStates)) {
    stateByEntryId.set(entryId, state);
  }
  return stateByEntryId;
}

function deriveLexiconStateVersion(
  entries: readonly LanguageLexicalEntry[],
  stateByEntryId: ReadonlyMap<string, InputKnowledgeState>,
): string {
  const material = entries
    .map((entry) => ({
      id: entry.id,
      state: stateByEntryId.get(entry.id) ?? entry.knowledgeState ?? null,
      ignored: entry.ignored,
      properNoun: entry.properNoun,
      version: entry.version,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const extraStates = [...stateByEntryId.entries()]
    .filter(([entryId]) => !entries.some((entry) => entry.id === entryId))
    .sort(([left], [right]) => left.localeCompare(right));
  return `lex_${digestText128(canonicalStableJson({ material, extraStates })).slice(0, 16)}`;
}

function mapAnalysisChunks(
  profileId: string,
  analysis: LanguageAnalysisResult,
  entries: readonly LanguageLexicalEntry[],
  stateByEntryId: ReadonlyMap<string, InputKnowledgeState>,
): CoverageChunkInput[] {
  const tokenByNormalized = new Map<string, LanguageLexicalEntry>();
  const tokenByLemma = new Map<string, LanguageLexicalEntry>();
  const phraseByNormalized = new Map<string, LanguageLexicalEntry>();

  for (const entry of entries) {
    if (entry.profileId !== profileId) continue;
    const normKey = entry.normalizedForm.toLowerCase();
    if (entry.objectKind === "phrase") {
      if (!phraseByNormalized.has(normKey)) phraseByNormalized.set(normKey, entry);
    } else {
      if (!tokenByNormalized.has(normKey)) tokenByNormalized.set(normKey, entry);
      const lemmaKey = (entry.lemma || entry.normalizedForm).toLowerCase();
      if (!tokenByLemma.has(lemmaKey)) tokenByLemma.set(lemmaKey, entry);
    }
  }

  const sourceChunks: readonly AnalysisChunk[] = analysis.chunks.length > 0 ? analysis.chunks : [analysis];
  return sourceChunks.map((chunk) => {
    const tokens: CoverageTokenInput[] = chunk.tokens.map((token) => {
      const normalizedLower = token.normalized.toLowerCase();
      const exactEntry = tokenByNormalized.get(normalizedLower);
      const lemmaEntry = token.lemma ? tokenByLemma.get(token.lemma.toLowerCase()) : undefined;
      const exactFormState = exactEntry ? stateByEntryId.get(exactEntry.id) : undefined;
      const lemmaState = lemmaEntry ? stateByEntryId.get(lemmaEntry.id) : undefined;
      const ignored = Boolean(
        exactEntry?.ignored ||
        lemmaEntry?.ignored ||
        exactFormState === "ignored" ||
        lemmaState === "ignored",
      );
      const properNoun = Boolean(exactEntry?.properNoun || lemmaEntry?.properNoun);
      return {
        id: token.id,
        surface: token.surface,
        normalized: token.normalized,
        kind: token.kind,
        confidence: token.confidence.score,
        lemma: token.lemma,
        properNoun,
        ignored,
        isLexical: token.isLexical,
        exactFormState,
        lemmaState,
        exactFormEntryId: exactEntry?.id,
        lemmaEntryId: lemmaEntry?.id,
        lexicalEntryId: exactEntry?.id ?? lemmaEntry?.id,
        start: token.start,
        end: token.end,
      };
    });

    const phrases: CoveragePhraseCandidate[] = chunk.phraseCandidates.map((phrase) => {
      const phraseEntry = phraseByNormalized.get(phrase.normalized.toLowerCase());
      const phraseState = phraseEntry ? stateByEntryId.get(phraseEntry.id) : undefined;
      return {
        id: phrase.id,
        surface: phrase.surface,
        normalized: phrase.normalized,
        tokenIds: phrase.tokenIds,
        confidence: phrase.confidence.score,
        state: phraseState,
        exactFormState: phraseState,
        exactFormEntryId: phraseEntry?.id,
        lexicalEntryId: phraseEntry?.id,
        start: phrase.start,
        end: phrase.end,
      };
    });

    return {
      chunkId: `${analysis.version.processingKey}:${chunk.chunkIndex}`,
      chunkIndex: chunk.chunkIndex,
      tokens,
      phrases,
    };
  });
}

function uniqueVocabPayload(summary: CoverageSummary): Record<string, unknown> {
  return {
    uniqueLemmaCount: summary.uniqueLemmaCount,
    uniqueSurfaceCount: summary.uniqueSurfaceCount,
    uniqueKnownCount: summary.uniqueKnownCount,
    uniqueFamiliarCount: summary.uniqueFamiliarCount,
    uniqueLearningCount: summary.uniqueLearningCount,
    uniqueNewCount: summary.uniqueNewCount,
    uniqueIgnoredCount: summary.uniqueIgnoredCount,
    uniqueUnresolvedCount: summary.uniqueUnresolvedCount,
    uniqueKnownPercent: summary.uniqueKnownPercent,
  };
}

/**
 * Compute coverage from a `LanguageAnalysisResult` and profile lexicon entries/states,
 * persist via `upsertLanguageCoverageResult`, update the reverse index, and return
 * the `CoverageSummary`.
 */
export async function saveAndComputeDocumentCoverage(
  input: SaveAndComputeDocumentCoverageInput,
): Promise<CoverageSummary> {
  const policy = input.policy ?? DEFAULT_COVERAGE_POLICY;
  const entries = input.lexiconEntries ?? [];
  const stateByEntryId = buildStateMap(input.profileId, entries, input.knowledgeStates);
  const lexiconStateVersion = input.lexiconStateVersion ?? deriveLexiconStateVersion(entries, stateByEntryId);
  const chunks = mapAnalysisChunks(input.profileId, input.analysis, entries, stateByEntryId);
  const processorVersion = `${input.analysis.version.adapterId}@${input.analysis.version.adapterVersion}`;
  const hasLemmaCapability = input.analysis.summary.capabilities.lemma?.supported ?? false;

  const documentInput: CoverageDocumentInput = {
    documentId: input.documentId,
    profileId: input.profileId,
    languageTag: input.analysis.version.languageTag,
    contentFingerprint: input.analysis.version.contentFingerprint,
    processorVersion,
    lexiconStateVersion,
    thresholdVersion: input.thresholdVersion ?? policy.bands.version,
    policy,
    analysisMethod: hasLemmaCapability ? "lemma-aware" : undefined,
    chunks,
  };

  const calculation = calculateCoverage(documentInput, { now: input.now });
  const referencedEntryIds = [...new Set(calculation.chunks.flatMap((chunk) => chunk.referencedEntryIds))].sort();

  for (const chunk of calculation.chunks) {
    const reference: CoverageChunkReference = {
      documentId: input.documentId,
      profileId: input.profileId,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      coverageKey: calculation.version.coverageKey,
      lexicalEntryIds: chunk.referencedEntryIds,
    };
    coverageReverseIndex.indexChunk(reference);
    input.reverseIndex?.indexChunk(reference);
  }

  const record: LanguageCoverageResultRecord = {
    coverageKey: calculation.version.coverageKey,
    documentId: input.documentId,
    profileId: input.profileId,
    contentFingerprint: calculation.version.contentFingerprint,
    processorVersion: calculation.version.processorVersion,
    lexiconStateVersion: calculation.version.lexiconStateVersion,
    policyVersion: calculation.version.policyVersion,
    thresholdVersion: calculation.version.thresholdVersion,
    method: calculation.summary.method,
    freshness: calculation.summary.freshness,
    summary: calculation.summary as unknown as Record<string, unknown>,
    uniqueVocab: uniqueVocabPayload(calculation.summary),
    computedAt: calculation.summary.computedAt,
    updatedAt: calculation.summary.computedAt,
  };

  const persist = input.persistResult ?? upsertLanguageCoverageResult;
  await persist(record, referencedEntryIds);
  return calculation.summary;
}

export async function getDocumentCoverageProjection(
  profileId: string,
  documentId: string,
  fallbackVersion: CoverageVersion,
  options: { fetchResults?: typeof getLanguageCoverageResults } = {},
): Promise<CoverageProjection> {
  const fetchResults = options.fetchResults ?? getLanguageCoverageResults;
  const records = await fetchResults(profileId, documentId);
  const latest = records[0];
  return projectionFromCoverageRecord(latest, fallbackVersion);
}
