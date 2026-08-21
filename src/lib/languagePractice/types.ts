import type { SourceAnchor } from "../../types/languageLexicon";

export type PracticeMode = "shadowing" | "dictation" | "writing" | "pronunciation";
export type PracticePrivacyMode = "local-only" | "allow-cloud";
export type PracticeAttemptStatus = "prompted" | "recording" | "submitted" | "cancelled" | "failed";

export interface PracticeSource {
  sourceType?: string;
  sourceId?: string;
  sourceAnchor?: SourceAnchor;
  sourceFingerprint?: string;
  mediaId?: string;
  startMs?: number;
  endMs?: number;
}

export interface RecordingPolicy {
  allowMicrophone: boolean;
  persistRecording: boolean;
  retentionExpiresAt?: number;
  privacy: PracticePrivacyMode;
}

export type ComparisonErrorKind = "missing" | "extra" | "substitution" | "punctuation" | "diacritic" | "order" | "script";

export interface ComparisonError {
  kind: ComparisonErrorKind;
  expected?: string;
  actual?: string;
  index: number;
}

export interface PracticeComparison {
  exact: boolean;
  score: number;
  expected: string;
  actual: string;
  normalizedExpected: string;
  normalizedActual: string;
  errors: readonly ComparisonError[];
  uncertain: boolean;
  assisted?: boolean;
}

export interface PracticeAttempt {
  id: string;
  profileId: string;
  mode: PracticeMode;
  source: PracticeSource;
  promptText: string;
  rawResponse?: string;
  normalizedResponse?: string;
  comparison?: PracticeComparison;
  status: PracticeAttemptStatus;
  recordingPolicy: RecordingPolicy;
  providerId?: string;
  providerVersion?: string;
  activeEvidenceAccepted: boolean;
  revealed?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PracticeRecommendationPreview {
  candidateId: string;
  title: string;
  sourceType: string;
  sourceId: string;
  sourceFingerprint: string;
  explanation: readonly string[];
  score: number;
}
