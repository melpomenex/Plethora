export const ASSESSMENT_DIMENSIONS = [
  "vocabularyBreadth",
  "grammarMorphology",
  "readingComprehension",
  "listeningComprehension",
  "writingProduction",
  "speakingPronunciation",
] as const;

export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

/**
 * Internal ordered calibration tiers used as rough reference landmarks.
 * These are internal heuristics and NEVER official or accredited CEFR certifications.
 */
export const PROFICIENCY_BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type ProficiencyBand = (typeof PROFICIENCY_BANDS)[number];

export const SUPPORTED_PLACEMENT_LANGUAGES = [
  "es",
  "fr",
  "de",
  "ja",
  "zh",
  "ko",
  "ar",
] as const;

export type SupportedPlacementLanguage = (typeof SUPPORTED_PLACEMENT_LANGUAGES)[number];

export type PlacementBankLanguage = SupportedPlacementLanguage | "universal";

export const NON_CEFR_DISCLAIMER =
  "Calibration heuristic only — NOT an official CEFR certification or accredited language exam. Estimates reflect internal approximations from observable Plethora evidence and placement items.";

export type DimensionCalibrationStatus = "calibrated" | "insufficient-evidence" | "unavailable";

export interface ConfidenceInterval {
  /** Lower bound on the internal 0–100 calibration scale. */
  low: number;
  /** Upper bound on the internal 0–100 calibration scale. */
  high: number;
  /** Lower calibration band covered by the uncertainty interval, or null if unavailable. */
  minBand: ProficiencyBand | null;
  /** Upper calibration band covered by the uncertainty interval, or null if unavailable. */
  maxBand: ProficiencyBand | null;
}

export interface DimensionEstimate {
  dimension: AssessmentDimension;
  status: DimensionCalibrationStatus;
  available: boolean;
  estimatedLevel: ProficiencyBand | null;
  /** Internal continuous score on a 0–100 scale, or null when unavailable. */
  numericScore: number | null;
  /** Confidence in [0, 1]; 0 when unavailable. */
  confidenceScore: number;
  confidenceInterval: ConfidenceInterval;
  sampleCount: number;
  calibrationNote: string;
  /** Latent IRT theta estimate in [-3, 3], or null when unavailable. */
  theta: number | null;
  /** Posterior Standard Error of Measurement, or null when unavailable. */
  sem: number | null;
}

export interface IrtParameters {
  /** Item difficulty parameter b in [-3, 3]. */
  difficulty: number;
  /** Item discrimination parameter a > 0 (1.0 corresponds to 1PL Rasch). */
  discrimination: number;
  /** Pseudo-guessing lower asymptote c in [0, 0.35], defaults to 0 (2PL). */
  guessing?: number;
}

export type AssessmentResponseFormat =
  | "multiple-choice"
  | "cloze"
  | "free-response"
  | "spoken-response";

export interface AssessmentItem {
  id: string;
  language: PlacementBankLanguage;
  dimension: AssessmentDimension;
  targetBand: ProficiencyBand;
  responseFormat: AssessmentResponseFormat;
  prompt: string;
  contextPassage?: string;
  audioTranscriptHint?: string;
  options?: readonly string[];
  correctOptionIndex?: number;
  acceptedPatterns?: readonly string[];
  rubricHint?: string;
  irt: IrtParameters;
}

export interface AdaptiveResponseRecord {
  itemId: string;
  dimension: AssessmentDimension;
  correct: boolean;
  /** Normalized score in [0, 1] used by the IRT update. */
  score: number;
  skipped: boolean;
  selectedOptionIndex?: number;
  textResponse?: string;
  responseTimeMs?: number;
  thetaBefore: number;
  thetaAfter: number;
  semBefore: number;
  semAfter: number;
  answeredAt: number;
}

export interface DimensionAdaptiveState {
  dimension: AssessmentDimension;
  enabled: boolean;
  theta: number;
  sem: number;
  /** Posterior distribution over the IRT quadrature grid. */
  posterior: readonly number[];
  answeredItemIds: readonly string[];
  skippedItemIds: readonly string[];
  sampleCount: number;
}

export type PlacementStopReason =
  | "target-sem-reached"
  | "max-items-reached"
  | "item-pool-exhausted"
  | "user-stopped-early";

export interface PlacementSessionConfig {
  targetLanguage: string;
  resolvedBankLanguage: PlacementBankLanguage;
  usedUniversalFallback: boolean;
  dimensions: readonly AssessmentDimension[];
  maxItems: number;
  minItemsPerDimension: number;
  targetSem: number;
  priorMean: number;
  priorSd: number;
}

export interface PlacementSession {
  sessionId: string;
  profileId?: string;
  createdAt: number;
  updatedAt: number;
  config: PlacementSessionConfig;
  itemPool: readonly AssessmentItem[];
  dimensionStates: Record<AssessmentDimension, DimensionAdaptiveState>;
  history: readonly AdaptiveResponseRecord[];
  currentItem: AssessmentItem | null;
  isComplete: boolean;
  stopReason: PlacementStopReason | null;
  isOfficialCertification: false;
  disclaimer: string;
}

export interface PlacementSessionOptions {
  targetLanguage: string;
  profileId?: string;
  sessionId?: string;
  dimensions?: readonly AssessmentDimension[];
  includeListening?: boolean;
  includeSpeaking?: boolean;
  maxItems?: number;
  minItemsPerDimension?: number;
  targetSem?: number;
  priorMean?: number;
  priorSd?: number;
  customItems?: readonly AssessmentItem[];
}

export interface AdaptiveItemResponseInput {
  itemId: string;
  correct?: boolean;
  score?: number;
  selectedOptionIndex?: number;
  textResponse?: string;
  responseTimeMs?: number;
  skip?: boolean;
  stopEarly?: boolean;
}

export interface PlacementResult {
  sessionId: string;
  targetLanguage: string;
  resolvedBankLanguage: PlacementBankLanguage;
  usedUniversalFallback: boolean;
  completed: boolean;
  stopReason: PlacementStopReason | null;
  totalItemsAnswered: number;
  dimensions: Record<AssessmentDimension, DimensionEstimate>;
  availableDimensions: readonly AssessmentDimension[];
  unavailableDimensions: readonly AssessmentDimension[];
  isOfficialCertification: false;
  disclaimer: string;
}

export interface StepAdaptiveResult {
  session: PlacementSession;
  recordedResponse: AdaptiveResponseRecord;
  nextItem: AssessmentItem | null;
  isComplete: boolean;
  stopReason: PlacementStopReason | null;
  estimate: PlacementResult;
  isOfficialCertification: false;
  disclaimer: string;
}

export interface LexicalKnowledgeCounts {
  known?: number;
  familiar?: number;
  learning?: number;
  encountered?: number;
  new?: number;
}

export interface ReadingEvidenceStats {
  averageCoverageRatio?: number;
  documentsRead?: number;
  readingMinutes?: number;
  readingTokens?: number;
  comprehensionAccuracy?: number;
  comprehensionCount?: number;
}

export interface ListeningEvidenceStats {
  listeningMinutes?: number;
  listeningSentences?: number;
  dictationAccuracy?: number;
  dictationCount?: number;
}

export interface GrammarEvidenceStats {
  accuracy?: number;
  attemptCount?: number;
  averageItemDifficulty?: number;
}

export interface WritingEvidenceStats {
  outputsCount?: number;
  averageScore?: number;
  averageWordCount?: number;
}

export interface SpeakingEvidenceStats {
  outputsCount?: number;
  pronunciationScore?: number;
  shadowingAccuracy?: number;
}

export interface ProfileEvidenceStats {
  targetLanguage?: string;
  lexicalCounts?: LexicalKnowledgeCounts;
  readingCoverage?: ReadingEvidenceStats;
  listeningStats?: ListeningEvidenceStats;
  grammarPractice?: GrammarEvidenceStats;
  writingStats?: WritingEvidenceStats;
  speakingStats?: SpeakingEvidenceStats;
}

export interface CombinedProficiencyResult {
  targetLanguage: string;
  dimensions: Record<AssessmentDimension, DimensionEstimate>;
  availableDimensions: readonly AssessmentDimension[];
  unavailableDimensions: readonly AssessmentDimension[];
  evidenceSources: {
    usedPlacement: boolean;
    usedProfileStats: boolean;
  };
  isOfficialCertification: false;
  disclaimer: string;
}
