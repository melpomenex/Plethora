/** Shared recording-session wire contracts. Durations/offsets are milliseconds. */
import type { LearningCardCandidate } from "../lib/ai/schemas/learningMaterial";

export type RecordingState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "paused"
  | "interrupted"
  | "finalizing"
  | "saved"
  | "recoverable"
  | "failed"
  | "discarded";

export type SessionOrigin = "recorded" | "file" | "transcript" | "url";
export type SessionContentType =
  | "lecture" | "meeting" | "seminar" | "interview" | "presentation"
  | "podcast" | "voice-note" | "other";
export type SessionIngestionState = "staging" | "saved" | "partial" | "failed" | "cancelled";
export type SessionAnalysisState =
  | "idle" | "queued" | "running" | "blocked" | "partial"
  | "completed" | "failed" | "cancelled";
export type SessionOperationStage = "capture" | "ingestion" | "transcription" | "analysis" | "approval";
export type SessionOperationErrorCode =
  | "PermissionDenied" | "CaptureBusy" | "UnsupportedCapture" | "UnsupportedCodec"
  | "StorageFull" | "StorageUnavailable" | "InvalidTranscript" | "InputTooLarge"
  | "StaleRevision" | "SourceUnavailable" | "ConsentRequired" | "ProviderUnavailable"
  | "ThermalPaused" | "Cancelled";

/** Content-free error data; localized copy belongs to the presentation layer. */
export interface SessionOperationError {
  code: SessionOperationErrorCode;
  stage: SessionOperationStage;
  sessionId?: string;
  retryable: boolean;
  recoverableAssetId?: string;
  messageKey: string;
}

export interface CaptureCapabilities {
  available: boolean;
  pause: boolean;
  background: boolean;
  liveCaptions: boolean;
  reason?: string;
}

export interface CaptureHandle {
  sessionId: string;
  writerEpoch: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  finish(): Promise<{ assetId: string; incomplete: boolean }>;
}

export interface RecordingHealth {
  acknowledgedMs: number;
  pendingBytes: number;
  lastCommitAt?: string;
  state: RecordingState;
  errorCode?: SessionOperationErrorCode;
}

/** Untimed text cannot carry a synthetic zero-second locator. */
export type SessionTranscriptTiming =
  | { kind: "measured" | "imported"; startMs: number; endMs: number }
  | { kind: "none"; startMs?: never; endMs?: never };

export interface SessionTranscriptWord {
  text: string;
  startMs: number;
  endMs: number;
  source: "measured" | "imported";
}

export interface SessionTranscriptSegment {
  segmentKey: string;
  transcriptId: number;
  ordinal: number;
  revision: number;
  text: string;
  timing: SessionTranscriptTiming;
  speakerId?: string;
  confidence?: number;
  words?: SessionTranscriptWord[];
}

export interface SessionSourceEvidence {
  version: 1;
  documentId: string;
  sessionId: string;
  assetId?: string;
  transcriptId: number;
  transcriptRevision: number;
  segmentKeys: string[];
  /** Exact immutable source snapshot, capped at 8,000 UTF-16 code units. */
  quote: string;
  ranges: { segmentKey: string; startUtf16: number; endUtf16: number }[];
  time?: { startMs: number; endMs: number; kind: "measured" | "imported" };
  section?: { id: string; label: string };
  speakerId?: string;
  markerIds: string[];
  precision: "segment" | "section" | "document";
  fingerprint: string;
  generation?: {
    taskId: string;
    taskVersion: string;
    provider: string;
    model?: string;
    createdAt: string;
    inputHash: string;
  };
}

interface SessionLearningDraftBase {
  id: string;
  sessionId: string;
  revision: number;
  status: "proposed" | "rejected" | "accepted" | "superseded";
  evidence: SessionSourceEvidence[];
  duplicate?: { cardId: string; similarity: number; method: string }[];
  acceptedTargetId?: string;
}

/** Correlated discriminants prevent a card draft from containing an extract payload. */
export type SessionLearningDraft = SessionLearningDraftBase & (
  | { kind: "card"; payload: { kind: "card"; candidate: LearningCardCandidate } }
  | { kind: "extract"; payload: { kind: "extract"; verbatimText: string; summaryNote?: string } }
);

export interface RecordingSession {
  id: string;
  documentId: string;
  origin: SessionOrigin;
  contentType: SessionContentType;
  /** Preserve unknown future content types while presenting them as "other". */
  originalContentType?: string;
  profileJson: string;
  captureState: RecordingState;
  ingestionState: SessionIngestionState;
  transcriptId: number | null;
  mediaAssetId: string | null;
  transcriptRevision: number;
  overviewJson: string | null;
  overviewRevision: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SessionRelatedDocument {
  id: string;
  title: string;
  fileType: string;
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  isAvailable: boolean;
}

export interface SessionMediaAsset {
  id: string;
  sessionId: string;
  kind: "original" | "capture" | "derived";
  relativePath: string;
  mime: string;
  byteLength: number;
  sha256: string | null;
  durationMs: number | null;
  state: "staging" | "ready" | "partial" | "missing" | "deleting";
  sourceUrl: string | null;
  sourceAdapter: string | null;
  createdAt: string;
}

export interface RecordingPart {
  assetId: string;
  writerEpoch: string;
  sequence: number;
  relativePath: string;
  byteLength: number;
  sha256: string;
  startMs: number;
  durationMs: number;
  formatJson: string;
  committedAt: string;
}

export type SessionMarkerKind =
  | "interesting"
  | "confusing"
  | "recent-extract"
  | "card-candidate"
  | "bookmark";

export type SessionMarkerState = "pending" | "resolved" | "needs-confirmation";

export interface RecordingSessionMarker {
  id: string;
  sessionId: string;
  kind: SessionMarkerKind;
  mediaMs: number;
  windowMs: number;
  partSequence: number | null;
  note: string | null;
  evidence: SessionSourceEvidence[] | null;
  state: SessionMarkerState;
  createdAt: string;
}

export interface SessionDocumentPrivacy {
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  privacyVersion: number;
}

export interface CreateRecordingSession {
  id: string;
  documentId?: string;
  collectionId?: string;
  title: string;
  origin: SessionOrigin;
  contentType: string;
  profileJson: string;
}

export interface RecordingSessionPage {
  items: RecordingSession[];
  nextCursor?: string;
}

export interface SessionSegmentPage {
  items: SessionTranscriptSegment[];
  revision: number;
  nextCursor?: string;
}

export interface RecoveryReport {
  sessionId: string;
  assetId: string;
  verifiedParts: number;
  corruptParts: number;
  missingGaps: number;
  acknowledgedDurationMs: number;
  acknowledgedBytes: number;
  state: RecordingState;
}

export interface LearningObjectSource {
  id: string;
  targetKind: "card" | "extract";
  targetId: string;
  sessionId?: string | null;
  documentId: string;
  evidenceJson: string;
  evidenceHash: string;
  createdAt: string;
}

export interface SessionAnalysisRun {
  id: string;
  sessionId: string;
  transcriptRevision: number;
  profileHash: string;
  taskVersion: string;
  generationEpoch: string;
  status: string;
  blockedReason?: string | null;
  completedUnits: number;
  totalUnits: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionAnalysisRun {
  id: string;
  sessionId: string;
  transcriptRevision: number;
  profileHash: string;
  taskVersion: string;
  generationEpoch: string;
  totalUnits: number;
}

export interface SessionAnalysisUnit {
  runId: string;
  unitKey: string;
  inputHash: string;
  segmentKeysJson: string;
  status: string;
  resultJson?: string | null;
  attempts: number;
  errorCode?: string | null;
}

export interface UpsertSessionAnalysisUnit {
  runId: string;
  unitKey: string;
  inputHash: string;
  segmentKeysJson: string;
  status: string;
  resultJson?: string | null;
  errorCode?: string | null;
}

export interface PersistedSessionLearningDraft {
  id: string;
  sessionId: string;
  runId: string | null;
  kind: "card" | "extract";
  status: "proposed" | "rejected" | "accepted" | "superseded";
  revision: number;
  payloadJson: string;
  evidenceJson: string;
  contentHash: string;
  conceptKey: string | null;
  duplicateJson: string | null;
  acceptedTargetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionLearningDraft {
  id: string;
  sessionId: string;
  runId?: string | null;
  kind: "card" | "extract";
  status?: string | null;
  payloadJson: string;
  evidenceJson: string;
  contentHash: string;
  conceptKey?: string | null;
  duplicateJson?: string | null;
}

export interface UpdateSessionLearningDraft {
  id: string;
  expectedRevision: number;
  payloadJson?: string | null;
  status?: string | null;
  duplicateJson?: string | null;
}

export interface SessionLearningDraftPage {
  items: PersistedSessionLearningDraft[];
  nextCursor?: string;
  total: number;
}

export interface AcceptSessionDraftSpec {
  draftId: string;
  expectedRevision: number;
  duplicateDecision?: 'create' | 'update' | 'replace' | null;
  duplicateTargetId?: string | null;
}

export interface AcceptSessionDraftsInput {
  sessionId: string;
  items: AcceptSessionDraftSpec[];
  provider?: string | null;
  model?: string | null;
  allOrNothing?: boolean | null;
}

export interface AcceptSessionDraftResult {
  draftId: string;
  success: boolean;
  targetId?: string | null;
  targetKind?: string | null;
  error?: string | null;
}

export interface AcceptSessionDraftsResponse {
  results: AcceptSessionDraftResult[];
  acceptedCount: number;
  failedCount: number;
}

export interface DeleteSessionMediaResult {
  sessionId: string;
  version: number;
  deletedAssetsCount: number;
  transcriptPreserved: boolean;
  cardsPreserved: boolean;
}

export interface DeleteRecordingSessionResult {
  sessionId: string;
  deleted: boolean;
  acceptedCardsRetained: boolean;
}

export interface CleanupJournalResult {
  cleanedCount: number;
  failedCount: number;
}
