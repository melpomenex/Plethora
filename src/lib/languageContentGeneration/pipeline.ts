import { createDocument, updateDocumentContent } from "../../api/documents";
import {
  recordLanguageGeneratedDocument,
  type LanguageGeneratedDocumentRecord,
} from "../../api/languageEcosystem";
import type { Document } from "../../types/document";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type { LanguageLexicalEntry } from "../../types/languageLexicon";
import type {
  AssociationMode,
  ContentType,
  DetectionEvidence,
  LanguageProfile,
} from "../../types/languageProfile";
import { estimateTokens } from "../ai/chunkTextByTokens";
import {
  calculateCoverage,
  DEFAULT_COVERAGE_POLICY,
  type CoverageCalculationResult,
  type CoverageChunkInput,
  type CoverageSummary,
  type CoverageTokenInput,
  type InputKnowledgeState,
  type LexicalCoveragePolicy,
} from "../languageCoverage";
import {
  LanguageProcessingRuntime,
  MemoryLanguageProcessingStore,
  digestText128,
  lexicalIdentity,
  type LanguageAnalysisResult,
} from "../languageProcessing";
import {
  buildLearnerContext,
  type ContextLexiconRow,
  type LearnerContextPacket,
} from "../languageTutor";
import { createAiLanguageContentGenerator } from "./aiGenerator";
import { LanguageContentGenerationService } from "./service";
import type {
  GeneratedLanguageDocument,
  LanguageContentGenerationRequest,
  LanguageContentGenerator,
} from "./types";

export const DEFAULT_COVERAGE_TOLERANCE_PERCENT = 5;
export const DEFAULT_MAX_REFINEMENTS = 2;
export const DEFAULT_CONTEXT_MAX_ITEMS = 40;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 600;
export const DEFAULT_SOURCE_TEXT_CODE_UNITS = 2400;

export type PipelineLexiconEntry =
  | LanguageLexicalEntry
  | ContextLexiconRow
  | {
      id?: string;
      entryId?: string;
      profileId?: string;
      surface?: string;
      canonicalForm?: string;
      normalizedForm?: string;
      lemma?: string;
      state?: InputKnowledgeState;
      knowledgeState?: string;
      evidenceCount?: number;
      activeEvidenceCount?: number;
      passiveEvidenceCount?: number;
      encounterCount?: number;
      ignored?: boolean;
      properNoun?: boolean;
      sourceDocumentId?: string;
    };

export interface PipelineProfileInput {
  id: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
}

export type ContentGenerationPipelineRequest = Omit<
  LanguageContentGenerationRequest,
  "requestId" | "profileId" | "targetLanguage" | "baseLanguage" | "learnerContext"
> & {
  requestId?: string;
  profileId?: string;
  targetLanguage?: string;
  baseLanguage?: string;
  learnerContext?: LearnerContextPacket;
};

export interface ContentGenerationContextBudget {
  maxItems?: number;
  maxTokenBudget?: number;
  maxSourceCodeUnits?: number;
}

export interface ContentGenerationCostSummary {
  totalGenerationCalls: number;
  maxRefinements: number;
  estimatedContextTokens: number;
  includedLexiconItems: number;
  totalLexiconEntries: number;
  measuredWordCount: number;
}

export interface ContentGenerationPipelineProgress {
  stage: "building-context" | "generating" | "analyzing" | "refining" | "completed" | "cancelled";
  attempt: number;
  maxRefinements: number;
  measuredCoverage?: number;
  targetCoveragePercent: number;
  unknownWordCount?: number;
  cost: ContentGenerationCostSummary;
}

export interface ContentGenerationPipelineInput {
  profile: PipelineProfileInput;
  request: ContentGenerationPipelineRequest;
  lexiconEntries: readonly PipelineLexiconEntry[];
  targetCoveragePercent: number;
  tolerancePercent?: number;
  maxRefinements?: number;
  generator?: LanguageContentGenerator;
  service?: LanguageContentGenerationService;
  processingRuntime?: LanguageProcessingRuntime;
  coveragePolicy?: LexicalCoveragePolicy;
  contextBudget?: ContentGenerationContextBudget;
  onProgress?: (progress: ContentGenerationPipelineProgress) => void;
  signal?: AbortSignal;
}

export interface ContentGenerationPipelineResult {
  generated: GeneratedLanguageDocument;
  analysis: LanguageAnalysisResult;
  measuredCoverage: number;
  coverageSummary: CoverageSummary;
  coverageResult: CoverageCalculationResult;
  targetCoveragePercent: number;
  meetsTarget: boolean;
  refinementAttempts: number;
  unknownWords: readonly string[];
  cost: ContentGenerationCostSummary;
  progressLog: readonly ContentGenerationPipelineProgress[];
}

interface NormalizedLexiconEntry {
  entryId: string;
  surface: string;
  normalized: string;
  lemma?: string;
  state: InputKnowledgeState;
  tutorState: LanguageKnowledgeState;
  evidenceCount: number;
  ignored: boolean;
  properNoun: boolean;
  sourceDocumentId?: string;
}

const KNOWN_STATES = new Set<string>(["known", "familiar", "learning", "encountered", "new", "ignored"]);

function normalizeLexiconState(entry: PipelineLexiconEntry): { state: InputKnowledgeState; tutorState: LanguageKnowledgeState } {
  const ignored = "ignored" in entry && entry.ignored === true;
  if (ignored) return { state: "ignored", tutorState: "ignored" };
  const raw = ("state" in entry ? entry.state : undefined) ?? ("knowledgeState" in entry ? entry.knowledgeState : undefined);
  const candidate = typeof raw === "string" && KNOWN_STATES.has(raw) ? raw : "new";
  if (candidate === "unresolved") {
    return { state: "unresolved", tutorState: "new" };
  }
  return {
    state: candidate as InputKnowledgeState,
    tutorState: candidate as LanguageKnowledgeState,
  };
}

function normalizeLexiconEntries(
  entries: readonly PipelineLexiconEntry[],
  profile: PipelineProfileInput,
): NormalizedLexiconEntry[] {
  const normalized: NormalizedLexiconEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if ("profileId" in entry && entry.profileId && entry.profileId !== profile.id) {
      continue;
    }
    const entryId =
      ("entryId" in entry ? entry.entryId : undefined) ??
      ("id" in entry ? entry.id : undefined) ??
      `entry-${index}`;
    const surface =
      ("surface" in entry ? entry.surface : undefined) ??
      ("canonicalForm" in entry ? entry.canonicalForm : undefined) ??
      ("normalizedForm" in entry ? entry.normalizedForm : undefined) ??
      "";
    const normalizedForm = lexicalIdentity(
      ("normalizedForm" in entry ? entry.normalizedForm : undefined) ?? surface,
      profile.targetLanguage,
    );
    if (!normalizedForm) continue;
    const rawLemma = "lemma" in entry ? entry.lemma : undefined;
    const lemma = rawLemma ? lexicalIdentity(rawLemma, profile.targetLanguage) : undefined;
    const { state, tutorState } = normalizeLexiconState(entry);
    const evidenceCount =
      ("evidenceCount" in entry && typeof entry.evidenceCount === "number" ? entry.evidenceCount : undefined) ??
      (("activeEvidenceCount" in entry ? entry.activeEvidenceCount ?? 0 : 0) +
        ("passiveEvidenceCount" in entry ? entry.passiveEvidenceCount ?? 0 : 0) +
        ("encounterCount" in entry ? entry.encounterCount ?? 0 : 0));
    normalized.push({
      entryId,
      surface: surface || normalizedForm,
      normalized: normalizedForm,
      lemma,
      state,
      tutorState,
      evidenceCount,
      ignored: ("ignored" in entry && entry.ignored === true) || state === "ignored",
      properNoun: "properNoun" in entry && entry.properNoun === true,
      sourceDocumentId: "sourceDocumentId" in entry ? entry.sourceDocumentId : undefined,
    });
  }
  return normalized;
}

/**
 * Select a balanced, strictly bounded subset of the learner's lexicon
 * (known, familiar, learning, and target vocabulary) within item & token budgets.
 * Never ships an unbounded lexicon into a prompt.
 */
export function buildBoundedGenerationContext(input: {
  profile: PipelineProfileInput;
  entries: readonly NormalizedLexiconEntry[];
  sourceDocumentId?: string;
  sourceText?: string;
  targetVocabulary?: readonly string[];
  budget?: ContentGenerationContextBudget;
}): { packet: LearnerContextPacket; estimatedTokens: number } {
  const maxItems = Math.max(1, Math.min(64, Math.floor(input.budget?.maxItems ?? DEFAULT_CONTEXT_MAX_ITEMS)));
  const maxTokenBudget = Math.max(64, Math.floor(input.budget?.maxTokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET));
  const maxSourceCodeUnits = Math.max(100, Math.floor(input.budget?.maxSourceCodeUnits ?? DEFAULT_SOURCE_TEXT_CODE_UNITS));

  const targetSet = new Set(
    (input.targetVocabulary ?? []).map((word) => lexicalIdentity(word, input.profile.targetLanguage)).filter(Boolean),
  );

  const active = input.entries.filter((entry) => !entry.ignored);
  const sortByEvidence = (left: NormalizedLexiconEntry, right: NormalizedLexiconEntry) => {
    const leftTarget = targetSet.has(left.normalized) || (left.lemma ? targetSet.has(left.lemma) : false) ? 1 : 0;
    const rightTarget = targetSet.has(right.normalized) || (right.lemma ? targetSet.has(right.lemma) : false) ? 1 : 0;
    if (leftTarget !== rightTarget) return rightTarget - leftTarget;
    return right.evidenceCount - left.evidenceCount || left.entryId.localeCompare(right.entryId);
  };

  const targetBucket = active
    .filter((entry) => entry.tutorState === "learning" || entry.tutorState === "encountered" || entry.tutorState === "new" || targetSet.has(entry.normalized))
    .sort(sortByEvidence);
  const familiarBucket = active
    .filter((entry) => entry.tutorState === "familiar" && !targetSet.has(entry.normalized))
    .sort(sortByEvidence);
  const knownBucket = active
    .filter((entry) => entry.tutorState === "known" && !targetSet.has(entry.normalized))
    .sort(sortByEvidence);

  const knownQuota = Math.max(1, Math.floor(maxItems * 0.4));
  const familiarQuota = Math.max(1, Math.floor(maxItems * 0.25));
  const targetQuota = Math.max(1, maxItems - knownQuota - familiarQuota);

  const selected: NormalizedLexiconEntry[] = [];
  const selectedIds = new Set<string>();
  const addFromBucket = (bucket: readonly NormalizedLexiconEntry[], limit: number) => {
    let added = 0;
    for (const entry of bucket) {
      if (selected.length >= maxItems || added >= limit) break;
      if (selectedIds.has(entry.entryId)) continue;
      selected.push(entry);
      selectedIds.add(entry.entryId);
      added += 1;
    }
  };

  addFromBucket(knownBucket, knownQuota);
  addFromBucket(familiarBucket, familiarQuota);
  addFromBucket(targetBucket, targetQuota);
  addFromBucket([...targetBucket, ...familiarBucket, ...knownBucket], maxItems);

  const budgetedRows: ContextLexiconRow[] = [];
  let runningTokens = 0;
  for (const entry of selected) {
    const cost = estimateTokens(`${entry.surface} ${entry.lemma ?? ""} ${entry.tutorState}`) + 2;
    if (budgetedRows.length > 0 && runningTokens + cost > maxTokenBudget) break;
    runningTokens += cost;
    budgetedRows.push({
      entryId: entry.entryId,
      surface: entry.surface,
      lemma: entry.lemma,
      state: entry.tutorState,
      evidenceCount: entry.evidenceCount,
      sourceDocumentId: entry.sourceDocumentId,
    });
  }

  const trimmedSource = input.sourceText?.trim();
  const packet = buildLearnerContext({
    profile: input.profile,
    lexicon: budgetedRows,
    currentSource: trimmedSource
      ? { documentId: input.sourceDocumentId, text: trimmedSource }
      : undefined,
    budget: {
      maxItems: budgetedRows.length || 1,
      maxTextCodeUnits: maxSourceCodeUnits,
      includeSourceText: Boolean(trimmedSource),
    },
  });

  // Preserve partial freshness if the source lexicon exceeded our bounded subset.
  const freshness = budgetedRows.length < active.length ? "partial" : packet.freshness;
  return {
    packet: { ...packet, freshness },
    estimatedTokens: runningTokens + (packet.currentSource ? estimateTokens(packet.currentSource.text) : 0),
  };
}

function statePrecedenceRank(state: InputKnowledgeState): number {
  switch (state) {
    case "known":
      return 5;
    case "familiar":
      return 4;
    case "learning":
      return 3;
    case "encountered":
    case "new":
      return 2;
    case "ignored":
    case "unresolved":
    default:
      return 1;
  }
}

function indexLexiconEntries(entries: readonly NormalizedLexiconEntry[]): {
  exactMap: Map<string, NormalizedLexiconEntry>;
  lemmaMap: Map<string, NormalizedLexiconEntry>;
  stateVersion: string;
} {
  const exactMap = new Map<string, NormalizedLexiconEntry>();
  const lemmaMap = new Map<string, NormalizedLexiconEntry>();

  const shouldReplace = (existing: NormalizedLexiconEntry | undefined, candidate: NormalizedLexiconEntry) => {
    if (!existing) return true;
    const rankDiff = statePrecedenceRank(candidate.state) - statePrecedenceRank(existing.state);
    if (rankDiff !== 0) return rankDiff > 0;
    return candidate.evidenceCount > existing.evidenceCount;
  };

  for (const entry of entries) {
    if (shouldReplace(exactMap.get(entry.normalized), entry)) {
      exactMap.set(entry.normalized, entry);
    }
    if (entry.lemma && shouldReplace(lemmaMap.get(entry.lemma), entry)) {
      lemmaMap.set(entry.lemma, entry);
    }
  }

  const digestInput = entries
    .map((entry) => `${entry.entryId}:${entry.normalized}:${entry.state}`)
    .sort()
    .join("|");

  return {
    exactMap,
    lemmaMap,
    stateVersion: `lex_${digestText128(digestInput).slice(0, 16)}`,
  };
}

async function measureGeneratedCoverage(input: {
  generated: GeneratedLanguageDocument;
  profile: PipelineProfileInput;
  entries: readonly NormalizedLexiconEntry[];
  runtime: LanguageProcessingRuntime;
  policy: LexicalCoveragePolicy;
  allowCloud: boolean;
  signal?: AbortSignal;
}): Promise<{
  analysis: LanguageAnalysisResult;
  coverage: CoverageCalculationResult;
  unknownWords: string[];
}> {
  const analysis = await input.runtime.process(
    {
      text: input.generated.content,
      languageTag: input.profile.targetLanguage,
      contentFingerprint: input.generated.generatedFingerprint,
    },
    {
      signal: input.signal,
      allowCloud: input.allowCloud,
    },
  );

  const { exactMap, lemmaMap, stateVersion } = indexLexiconEntries(input.entries);

  const chunks: CoverageChunkInput[] = analysis.chunks.map((chunk) => {
    const tokens: CoverageTokenInput[] = chunk.tokens.map((token) => {
      const normalizedKey = lexicalIdentity(token.normalized || token.surface, input.profile.targetLanguage);
      const lemmaKey = token.lemma ? lexicalIdentity(token.lemma, input.profile.targetLanguage) : undefined;
      const exactMatch = exactMap.get(normalizedKey);
      const lemmaMatch = lemmaKey ? (lemmaMap.get(lemmaKey) ?? exactMap.get(lemmaKey)) : undefined;

      return {
        id: token.id,
        surface: token.surface,
        normalized: normalizedKey,
        kind: token.kind,
        confidence: token.confidence.score,
        lemma: token.lemma,
        properNoun: exactMatch?.properNoun ?? lemmaMatch?.properNoun,
        ignored: exactMatch?.ignored ?? lemmaMatch?.ignored,
        isLexical: token.isLexical,
        exactFormState: exactMatch?.state,
        lemmaState: lemmaMatch?.state,
        exactFormEntryId: exactMatch?.entryId,
        lemmaEntryId: lemmaMatch?.entryId,
        start: token.start,
        end: token.end,
      };
    });

    const phrases = chunk.phraseCandidates.map((phrase) => {
      const phraseKey = lexicalIdentity(phrase.normalized || phrase.surface, input.profile.targetLanguage);
      const exactPhrase = exactMap.get(phraseKey);
      return {
        id: phrase.id,
        surface: phrase.surface,
        normalized: phraseKey,
        tokenIds: phrase.tokenIds,
        confidence: phrase.confidence.score,
        exactFormState: exactPhrase?.state,
        exactFormEntryId: exactPhrase?.entryId,
        start: phrase.start,
        end: phrase.end,
      };
    });

    return {
      chunkId: `chunk-${chunk.chunkIndex}`,
      chunkIndex: chunk.chunkIndex,
      tokens,
      phrases,
    };
  });

  const coverage = calculateCoverage({
    documentId: input.generated.documentId,
    profileId: input.profile.id,
    languageTag: input.profile.targetLanguage,
    contentFingerprint: input.generated.generatedFingerprint,
    processorVersion: `${analysis.version.adapterId}@${analysis.version.adapterVersion}`,
    lexiconStateVersion: stateVersion,
    policy: input.policy,
    chunks,
  });

  const unknownSet = new Set<string>();
  for (const chunk of coverage.chunks) {
    for (const unit of chunk.units) {
      if (unit.state === "new" || unit.state === "unresolved") {
        unknownSet.add(unit.surface);
      }
    }
  }

  return {
    analysis,
    coverage,
    unknownWords: [...unknownSet],
  };
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }
}

function isCoverageWithinTolerance(
  measuredCoverage: number,
  targetCoveragePercent: number,
  tolerancePercent: number,
  totalCountedUnits: number,
): boolean {
  if (totalCountedUnits <= 0) return false;
  return Math.abs(measuredCoverage - targetCoveragePercent) <= tolerancePercent;
}

/**
 * End-to-end personalized content generation & document adaptation pipeline:
 * 1. Builds a strictly bounded LearnerContextPacket (never sends whole lexicons).
 * 2. Generates or adapts text via LanguageContentGenerationService.
 * 3. Independently tokenizes & measures real coverage via LanguageProcessingRuntime + calculateCoverage.
 * 4. Runs bounded refinement attempts if measured coverage deviates beyond tolerance.
 */
export async function runContentGenerationPipeline(
  input: ContentGenerationPipelineInput,
): Promise<ContentGenerationPipelineResult> {
  const signal = input.signal ?? input.request.signal;
  throwIfCancelled(signal);

  if (input.request.profileId && input.request.profileId !== input.profile.id) {
    throw new Error("invalid-language-generation-context");
  }

  const maxRefinements = Math.max(0, Math.floor(input.maxRefinements ?? DEFAULT_MAX_REFINEMENTS));
  const tolerancePercent = Math.max(0, input.tolerancePercent ?? DEFAULT_COVERAGE_TOLERANCE_PERCENT);
  const policy = input.coveragePolicy ?? DEFAULT_COVERAGE_POLICY;
  const runtime =
    input.processingRuntime ??
    new LanguageProcessingRuntime({ store: new MemoryLanguageProcessingStore() });
  const service =
    input.service ??
    new LanguageContentGenerationService([
      input.generator ?? createAiLanguageContentGenerator(),
    ]);

  const progressLog: ContentGenerationPipelineProgress[] = [];
  const normalizedEntries = normalizeLexiconEntries(input.lexiconEntries, input.profile);
  const totalLexiconEntries = input.lexiconEntries.length;

  let learnerContext = input.request.learnerContext;
  let estimatedContextTokens = 0;
  if (!learnerContext) {
    const bounded = buildBoundedGenerationContext({
      profile: input.profile,
      entries: normalizedEntries,
      sourceDocumentId: input.request.sourceDocumentId,
      sourceText: input.request.sourceText,
      targetVocabulary: input.request.targetVocabulary,
      budget: input.contextBudget,
    });
    learnerContext = bounded.packet;
    estimatedContextTokens = bounded.estimatedTokens;
  } else {
    estimatedContextTokens =
      learnerContext.items.reduce(
        (sum, item) => sum + estimateTokens(`${item.surface} ${item.lemma ?? ""} ${item.state}`) + 2,
        0,
      ) + (learnerContext.currentSource ? estimateTokens(learnerContext.currentSource.text) : 0);
  }

  const makeCost = (calls: number, measuredWordCount: number): ContentGenerationCostSummary => ({
    totalGenerationCalls: calls,
    maxRefinements,
    estimatedContextTokens,
    includedLexiconItems: learnerContext.items.length,
    totalLexiconEntries,
    measuredWordCount,
  });

  const emit = (progress: ContentGenerationPipelineProgress) => {
    progressLog.push(progress);
    input.onProgress?.(progress);
  };

  emit({
    stage: "building-context",
    attempt: 0,
    maxRefinements,
    targetCoveragePercent: input.targetCoveragePercent,
    cost: makeCost(0, 0),
  });

  const baseRequestId =
    input.request.requestId ??
    `req_${digestText128(`${input.profile.id}:${input.request.action}:${input.request.topic}:${Date.now()}`).slice(0, 16)}`;

  const baseRequest: LanguageContentGenerationRequest = {
    ...input.request,
    requestId: baseRequestId,
    profileId: input.profile.id,
    targetLanguage: input.request.targetLanguage ?? input.profile.targetLanguage,
    baseLanguage: input.request.baseLanguage ?? input.profile.baseLanguage,
    proficiency: input.request.proficiency ?? input.profile.proficiency,
    targetCoveragePercent: input.request.targetCoveragePercent ?? input.targetCoveragePercent,
    learnerContext,
    signal,
  };

  const allowProcessingCloud =
    baseRequest.privacy === "allow-cloud" && baseRequest.allowCloud !== false;

  let generationCalls = 0;
  let refinementAttempts = 0;

  const evaluateAttempt = async (req: LanguageContentGenerationRequest, attemptNumber: number) => {
    throwIfCancelled(signal);
    emit({
      stage: attemptNumber === 0 ? "generating" : "refining",
      attempt: attemptNumber,
      maxRefinements,
      targetCoveragePercent: input.targetCoveragePercent,
      cost: makeCost(generationCalls, 0),
    });

    generationCalls += 1;
    const rawGenerated = await service.generate(req);
    throwIfCancelled(signal);

    emit({
      stage: "analyzing",
      attempt: attemptNumber,
      maxRefinements,
      targetCoveragePercent: input.targetCoveragePercent,
      cost: makeCost(generationCalls, 0),
    });

    const measured = await measureGeneratedCoverage({
      generated: rawGenerated,
      profile: input.profile,
      entries: normalizedEntries,
      runtime,
      policy,
      allowCloud: allowProcessingCloud,
      signal,
    });
    throwIfCancelled(signal);

    const measuredCoverage = measured.coverage.summary.coveragePercent;
    const generated: GeneratedLanguageDocument = {
      ...rawGenerated,
      measuredCoverageStatus: "ready",
      measuredCoveragePercent: measuredCoverage,
    };
    const meetsTarget = isCoverageWithinTolerance(
      measuredCoverage,
      input.targetCoveragePercent,
      tolerancePercent,
      measured.coverage.summary.totalCountedUnits,
    );

    return {
      generated,
      analysis: measured.analysis,
      measuredCoverage,
      coverageSummary: measured.coverage.summary,
      coverageResult: measured.coverage,
      meetsTarget,
      unknownWords: measured.unknownWords,
    };
  };

  let best: Awaited<ReturnType<typeof evaluateAttempt>>;
  let latest: Awaited<ReturnType<typeof evaluateAttempt>>;

  try {
    latest = await evaluateAttempt(baseRequest, 0);
    best = latest;

    while (!latest.meetsTarget && refinementAttempts < maxRefinements) {
      throwIfCancelled(signal);
      refinementAttempts += 1;

      const refinedRequest: LanguageContentGenerationRequest = {
        ...baseRequest,
        refinementFeedback: {
          attempt: refinementAttempts,
          previousText: latest.generated.content,
          measuredCoveragePercent: latest.measuredCoverage,
          targetCoveragePercent: input.targetCoveragePercent,
          unknownWords: latest.unknownWords,
        },
      };

      latest = await evaluateAttempt(refinedRequest, refinementAttempts);
      const latestDistance = Math.abs(latest.measuredCoverage - input.targetCoveragePercent);
      const bestDistance = Math.abs(best.measuredCoverage - input.targetCoveragePercent);
      if (latestDistance <= bestDistance) {
        best = latest;
      }
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.message === "cancelled")) {
      emit({
        stage: "cancelled",
        attempt: refinementAttempts,
        maxRefinements,
        targetCoveragePercent: input.targetCoveragePercent,
        cost: makeCost(generationCalls, 0),
      });
      throw new Error("cancelled");
    }
    throw error;
  }

  const finalCost = makeCost(generationCalls, best.coverageSummary.totalCountedTokens);
  emit({
    stage: "completed",
    attempt: refinementAttempts,
    maxRefinements,
    measuredCoverage: best.measuredCoverage,
    targetCoveragePercent: input.targetCoveragePercent,
    unknownWordCount: best.unknownWords.length,
    cost: finalCost,
  });

  return {
    generated: best.generated,
    analysis: best.analysis,
    measuredCoverage: best.measuredCoverage,
    coverageSummary: best.coverageSummary,
    coverageResult: best.coverageResult,
    targetCoveragePercent: input.targetCoveragePercent,
    meetsTarget: best.meetsTarget,
    refinementAttempts,
    unknownWords: best.unknownWords,
    cost: finalCost,
    progressLog,
  };
}

export type CreateGeneratedLibraryDocumentFn = (input: {
  title: string;
  content: string;
  filePath: string;
  fileType: string;
  collectionId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<Pick<Document, "id" | "title"> & Partial<Document>>;

export interface ImportGeneratedDocumentInput {
  pipelineResult: ContentGenerationPipelineResult;
  profile: Pick<LanguageProfile, "id" | "targetLanguage">;
  associateContent: (input: {
    profileId: string;
    contentType: ContentType;
    contentId: string;
    mode: AssociationMode;
    detectionEvidence?: DetectionEvidence;
  }) => Promise<unknown>;
  createDocumentFn?: CreateGeneratedLibraryDocumentFn;
  updateDocumentContentFn?: (id: string, content: string) => Promise<Document>;
  recordGeneratedDocumentFn?: typeof recordLanguageGeneratedDocument;
  collectionId?: string;
}

export interface ImportedGeneratedDocumentResult {
  document: Pick<Document, "id" | "title"> & Partial<Document>;
  association: unknown;
  generatedRecord: LanguageGeneratedDocumentRecord;
}

/**
 * Import an accepted generated or adapted document into Plethora's library
 * with honest provenance and profile association. Never overwrites a source document.
 */
export async function importGeneratedDocumentToLibrary(
  input: ImportGeneratedDocumentInput,
): Promise<ImportedGeneratedDocumentResult> {
  const { pipelineResult, profile, associateContent } = input;
  const { generated } = pipelineResult;

  if (generated.profileId !== profile.id) {
    throw new Error("invalid-language-generation-context");
  }

  const filePath = `plethora://language-generated/${profile.id}/${generated.generatedFingerprint.slice(0, 16)}-${generated.createdAt}.md`;
  const createFn: CreateGeneratedLibraryDocumentFn =
    input.createDocumentFn ??
    (async ({ title, content, filePath: path, fileType, collectionId }) => {
      const created = await createDocument(title, path, fileType, collectionId);
      if (generated.sourceDocumentId && created.id === generated.sourceDocumentId) {
        throw new Error("cannot-overwrite-source-document");
      }
      const updateContent = input.updateDocumentContentFn ?? updateDocumentContent;
      const updated = await updateContent(created.id, content);
      return { ...created, ...updated, content };
    });

  const document = await createFn({
    title: generated.title,
    content: generated.content,
    filePath,
    fileType: "markdown",
    collectionId: input.collectionId,
    metadata: {
      languageProfileId: profile.id,
      targetLanguage: profile.targetLanguage,
      generatedFingerprint: generated.generatedFingerprint,
      sourceDocumentId: generated.sourceDocumentId,
      sourceFingerprint: generated.sourceFingerprint,
      actionKind: generated.provenance.action,
      measuredCoveragePercent: pipelineResult.measuredCoverage,
      targetCoveragePercent: pipelineResult.targetCoveragePercent,
    },
  });

  if (generated.sourceDocumentId && document.id === generated.sourceDocumentId) {
    throw new Error("cannot-overwrite-source-document");
  }

  const association = await associateContent({
    profileId: profile.id,
    contentType: "document",
    contentId: document.id,
    mode: "enabled",
    detectionEvidence: {
      language: profile.targetLanguage,
      confidence: 1,
      detector: "language-content-generation",
      source: generated.provenance.action,
    },
  });

  const recordFn = input.recordGeneratedDocumentFn ?? recordLanguageGeneratedDocument;
  const generatedRecord = await recordFn({
    id: `lang_gen_${document.id}`,
    profileId: profile.id,
    documentId: document.id,
    sourceDocumentId: generated.sourceDocumentId,
    actionKind: generated.provenance.action,
    targetCoverage: pipelineResult.targetCoveragePercent,
    measuredCoverage: pipelineResult.measuredCoverage,
    providerId: generated.providerId,
    modelId: generated.modelId ?? generated.provenance.modelId,
    promptSummary: generated.title,
    provenance: {
      ...generated.provenance,
      generatedFingerprint: generated.generatedFingerprint,
      sourceFingerprint: generated.sourceFingerprint,
      measuredCoverageStatus: generated.measuredCoverageStatus,
      refinementAttempts: pipelineResult.refinementAttempts,
      meetsTarget: pipelineResult.meetsTarget,
      ...(generated.claimedCoveragePercent !== undefined
        ? { unverifiedClaimedCoveragePercent: generated.claimedCoveragePercent }
        : {}),
    },
    createdAt: generated.createdAt,
  });

  return {
    document,
    association,
    generatedRecord,
  };
}
