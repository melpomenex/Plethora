/**
 * Provider-independent contracts for profile-specific lexical coverage.
 *
 * Coverage is derived data. These contracts intentionally carry the versions
 * needed to decide whether a result can be displayed, without coupling the
 * calculator to SQLite, Tauri, or a particular language processor.
 */

export const LANGUAGE_COVERAGE_CONTRACT_VERSION = "1.0.0" as const;

export type CoverageFreshness = "pending" | "fresh" | "stale" | "unavailable" | "failed";
export type CoverageJobState = "queued" | "running" | "completed" | "cancelled" | "failed" | "stale";

export type CoverageKnowledgeState = "known" | "familiar" | "learning" | "new" | "unresolved";
export type InputKnowledgeState = CoverageKnowledgeState | "encountered" | "ignored";
export type CoverageStateSource = "exact-form" | "lemma" | "phrase" | "fallback";

export type CoverageTokenKind = "word" | "number" | "punctuation" | "symbol" | "other";
export type CoverageCountingUnitKind = "token" | "phrase";
export type CoverageCountingUnitMode = "token" | "phrase-aware";
export type PhraseOverlapPolicy = "longest-high-confidence" | "disabled";
export type LowConfidenceTreatment = "unresolved" | "exclude";
export type IgnoredTermTreatment = "exclude" | "unresolved";

/** The order is part of the coverage contract and must remain deterministic. */
export const COVERAGE_STATE_PRECEDENCE = [
  "exact-form",
  "lemma",
  "phrase",
  "unknown",
] as const;

export type CoverageStatePrecedenceStep = (typeof COVERAGE_STATE_PRECEDENCE)[number];

export interface CoverageStateWeights {
  known: number;
  familiar: number;
  learning: number;
  new: number;
  unresolved: number;
}

export interface DifficultySignalWeights {
  lexicalGap: number;
  unresolvedDensity: number;
  phraseDifficulty: number;
  documentLength: number;
}

export interface CoverageBandDefinition {
  id: string;
  label: string;
  /** Inclusive lower bound on the 0–100 difficulty score. */
  minDifficultyScore: number;
  /** Exclusive upper bound, except for the final band which may use 101. */
  maxDifficultyScore: number;
}

export interface CoverageBandConfiguration {
  version: string;
  bands: readonly CoverageBandDefinition[];
}

export interface LexicalCoveragePolicy {
  id: string;
  version: string;
  countingUnitMode: CoverageCountingUnitMode;
  /** Numbers are never inferred as vocabulary; this flag opts them in. */
  countNumbers: boolean;
  /** Named entities can be excluded without turning them into unknown words. */
  countProperNouns: boolean;
  ignoredTermTreatment: IgnoredTermTreatment;
  lowConfidenceTreatment: LowConfidenceTreatment;
  lowConfidenceThreshold: number;
  phraseOverlap: PhraseOverlapPolicy;
  phraseMinConfidence: number;
  /** A phrase replaces its component tokens but retains their token weight. */
  phraseWeight: number;
  properNounWeight: number;
  numberWeight: number;
  stateWeights: CoverageStateWeights;
  difficultyWeights: DifficultySignalWeights;
  bands: CoverageBandConfiguration;
}

export const DEFAULT_COVERAGE_BANDS: CoverageBandConfiguration = {
  version: "default-1",
  bands: [
    { id: "very-easy", label: "Very easy", minDifficultyScore: 0, maxDifficultyScore: 10 },
    { id: "comfortable", label: "Comfortable", minDifficultyScore: 10, maxDifficultyScore: 25 },
    { id: "productive-challenge", label: "Productive challenge", minDifficultyScore: 25, maxDifficultyScore: 45 },
    { id: "difficult", label: "Difficult", minDifficultyScore: 45, maxDifficultyScore: 70 },
    { id: "very-difficult", label: "Very difficult", minDifficultyScore: 70, maxDifficultyScore: 101 },
  ],
};

export const DEFAULT_COVERAGE_POLICY: LexicalCoveragePolicy = {
  id: "default-lexical-coverage",
  version: "1",
  countingUnitMode: "phrase-aware",
  countNumbers: false,
  countProperNouns: true,
  ignoredTermTreatment: "exclude",
  lowConfidenceTreatment: "unresolved",
  lowConfidenceThreshold: 0.65,
  phraseOverlap: "longest-high-confidence",
  phraseMinConfidence: 0.7,
  phraseWeight: 1,
  properNounWeight: 1,
  numberWeight: 1,
  stateWeights: {
    known: 1,
    familiar: 0.75,
    learning: 0.5,
    new: 0,
    unresolved: 0,
  },
  difficultyWeights: {
    lexicalGap: 0.65,
    unresolvedDensity: 0.2,
    phraseDifficulty: 0.1,
    documentLength: 0.05,
  },
  bands: DEFAULT_COVERAGE_BANDS,
};

export type CoverageAnalysisMethod = "lemma-aware" | "exact-form-fallback" | "unsupported-exact-form";

export interface CoverageTokenInput {
  id: string;
  surface: string;
  normalized: string;
  kind: CoverageTokenKind;
  /** Analysis confidence. A null/undefined value is unknown, not high confidence. */
  confidence?: number | null;
  lemma?: string;
  properNoun?: boolean;
  ignored?: boolean;
  isLexical?: boolean;
  /** `state` is an ergonomic alias for an exact-form state. */
  state?: InputKnowledgeState;
  exactFormState?: InputKnowledgeState;
  lemmaState?: InputKnowledgeState;
  exactFormEntryId?: string;
  lemmaEntryId?: string;
  lexicalEntryId?: string;
  start?: number;
  end?: number;
}

export interface CoveragePhraseCandidate {
  id: string;
  surface: string;
  normalized: string;
  tokenIds: readonly string[];
  confidence?: number | null;
  state?: InputKnowledgeState;
  exactFormState?: InputKnowledgeState;
  lemmaState?: InputKnowledgeState;
  exactFormEntryId?: string;
  lemmaEntryId?: string;
  lexicalEntryId?: string;
  start?: number;
  end?: number;
}

export interface CoverageChunkInput {
  chunkId: string;
  chunkIndex: number;
  tokens: readonly CoverageTokenInput[];
  phrases?: readonly CoveragePhraseCandidate[];
}

export interface CoverageDocumentInput {
  documentId: string;
  profileId: string;
  languageTag: string;
  contentFingerprint: string;
  processorVersion: string;
  lexiconStateVersion: string;
  thresholdVersion?: string;
  policy: LexicalCoveragePolicy;
  analysisMethod?: CoverageAnalysisMethod;
  chunks: readonly CoverageChunkInput[];
}

export interface CoverageVersion {
  contractVersion: string;
  documentId: string;
  profileId: string;
  languageTag: string;
  contentFingerprint: string;
  processorVersion: string;
  lexiconStateVersion: string;
  policyVersion: string;
  thresholdVersion: string;
  coverageKey: string;
}

export interface CoverageExclusionCounts {
  punctuation: number;
  symbols: number;
  nonLexical: number;
  numbers: number;
  properNouns: number;
  ignored: number;
  lowConfidence: number;
  invalidPhrases: number;
}

export interface CoverageStateCounts {
  known: number;
  familiar: number;
  learning: number;
  new: number;
  unresolved: number;
}

export type UnresolvedReason =
  | "ambiguous-lemma"
  | "low-confidence"
  | "missing-analysis"
  | "missing-knowledge-state"
  | "unsupported-language"
  | "phrase-analysis";

export interface CoverageCountingUnit {
  id: string;
  kind: CoverageCountingUnitKind;
  surface: string;
  normalized: string;
  lemma?: string;
  tokenIds: readonly string[];
  tokenCount: number;
  weight: number;
  state: CoverageKnowledgeState;
  stateSource: CoverageStateSource;
  confidence?: number | null;
  lexicalEntryId?: string;
  unresolvedReason?: UnresolvedReason;
  properNoun?: boolean;
}

export interface CoverageChunkResult {
  chunkId: string;
  chunkIndex: number;
  units: readonly CoverageCountingUnit[];
  stateCounts: CoverageStateCounts;
  totalWeight: number;
  countedTokenCount: number;
  uniqueLemmaKeys: readonly string[];
  referencedEntryIds: readonly string[];
  excluded: CoverageExclusionCounts;
  unresolvedReasons: Readonly<Partial<Record<UnresolvedReason, number>>>;
  selectedPhraseIds: readonly string[];
}

export interface CoverageDifficultySignals {
  lexicalGap: number;
  unresolvedDensity: number;
  phraseDifficulty: number;
  documentLength: number;
}

export interface CoverageSummary {
  freshness: "fresh";
  version: CoverageVersion;
  method: CoverageAnalysisMethod;
  computedAt: number;
  totalCountedUnits: number;
  totalCountedTokens: number;
  totalWeight: number;
  stateCounts: CoverageStateCounts;
  excluded: CoverageExclusionCounts;
  knownCoveragePercent: number;
  /** Weighted known/familiar/learning coverage, in [0, 100]. */
  coveragePercent: number;
  unknownPercent: number;
  unresolvedPercent: number;
  unresolvedCount: number;
  uniqueLemmaCount: number;
  phraseCount: number;
  difficultyScore: number;
  difficultyBand: string;
  difficultyLabel: string;
  difficultySignals: CoverageDifficultySignals;
}

export interface CoverageCalculationResult {
  version: CoverageVersion;
  summary: CoverageSummary;
  chunks: readonly CoverageChunkResult[];
}

export interface CoverageProjection {
  freshness: CoverageFreshness;
  version: CoverageVersion;
  summary?: CoverageSummary;
  error?: string;
  requestedAt?: number;
  updatedAt?: number;
}

export interface CoverageDetail {
  freshness: CoverageFreshness;
  version: CoverageVersion;
  summary?: CoverageSummary;
  chunks: readonly CoverageChunkResult[];
  units: readonly CoverageCountingUnit[];
  error?: string;
}

export interface CoverageChunkReference {
  documentId: string;
  profileId: string;
  chunkId: string;
  chunkIndex: number;
  coverageKey: string;
  lexicalEntryIds: readonly string[];
}

export interface CoverageInvalidationPlan {
  lexicalEntryId: string;
  chunks: readonly CoverageChunkReference[];
  documentIds: readonly string[];
  coverageKeys: readonly string[];
}

export interface CoverageJobRequest {
  jobId: string;
  documentId: string;
  profileId: string;
  coverageKey: string;
  totalChunks: number;
  maxRetries: number;
}

export interface CoverageJobCheckpoint {
  request: CoverageJobRequest;
  state: CoverageJobState;
  nextChunkIndex: number;
  completedChunks: number;
  completedUnits: number;
  retryCount: number;
  updatedAt: number;
  error?: string;
}

export interface CoverageProgress {
  jobId: string;
  state: CoverageJobState;
  completedChunks: number;
  totalChunks: number;
  completedUnits: number;
  percent: number;
  retryCount: number;
  coverageKey: string;
  error?: string;
}

export interface CoverageJobResult {
  jobId: string;
  state: CoverageJobState;
  coverageKey: string;
  processedChunks: number;
  result?: CoverageCalculationResult;
  error?: string;
}
