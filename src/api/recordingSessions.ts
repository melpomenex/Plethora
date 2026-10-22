/**
 * API client for Recording Sessions, canonical transcripts, and document privacy.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  CreateRecordingSession,
  LearningObjectSource,
  RecordingPart,
  RecordingSession,
  RecordingSessionMarker,
  RecordingSessionPage,
  RecoveryReport,
  SessionDocumentPrivacy,
  SessionMarkerKind,
  SessionMarkerState,
  SessionMediaAsset,
  SessionOperationError,
  SessionOperationErrorCode,
  SessionOperationStage,
  SessionSegmentPage,
  CreateSessionAnalysisRun,
  SessionAnalysisRun,
  SessionAnalysisUnit,
  UpsertSessionAnalysisUnit,
  PersistedSessionLearningDraft,
  CreateSessionLearningDraft,
  UpdateSessionLearningDraft,
  SessionLearningDraftPage,
  AcceptSessionDraftSpec,
  AcceptSessionDraftsInput,
  AcceptSessionDraftResult,
  AcceptSessionDraftsResponse,
  DeleteSessionMediaResult,
  DeleteRecordingSessionResult,
  CleanupJournalResult,
  SessionRelatedDocument,
} from "../types/recordingSession";

export type {
  CreateRecordingSession,
  LearningObjectSource,
  RecordingPart,
  RecordingSession,
  RecordingSessionMarker,
  RecordingSessionPage,
  RecoveryReport,
  SessionDocumentPrivacy,
  SessionMarkerKind,
  SessionMarkerState,
  SessionMediaAsset,
  SessionOperationError,
  SessionOperationErrorCode,
  SessionOperationStage,
  SessionSegmentPage,
  CreateSessionAnalysisRun,
  SessionAnalysisRun,
  SessionAnalysisUnit,
  UpsertSessionAnalysisUnit,
  PersistedSessionLearningDraft,
  CreateSessionLearningDraft,
  UpdateSessionLearningDraft,
  SessionLearningDraftPage,
  AcceptSessionDraftSpec,
  AcceptSessionDraftsInput,
  AcceptSessionDraftResult,
  AcceptSessionDraftsResponse,
};

export class RecordingSessionApiError extends Error implements SessionOperationError {
  public readonly code: SessionOperationErrorCode;
  public readonly stage: SessionOperationStage;
  public readonly sessionId?: string;
  public readonly retryable: boolean;
  public readonly recoverableAssetId?: string;
  public readonly messageKey: string;

  constructor(error: SessionOperationError) {
    super(`${error.stage}:${error.code}:${error.messageKey}`);
    this.name = "RecordingSessionApiError";
    this.code = error.code;
    this.stage = error.stage;
    this.sessionId = error.sessionId;
    this.retryable = error.retryable;
    this.recoverableAssetId = error.recoverableAssetId;
    this.messageKey = error.messageKey;
  }
}

export function isSessionOperationError(error: unknown): error is SessionOperationError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<SessionOperationError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.stage === "string" &&
    typeof candidate.retryable === "boolean" &&
    typeof candidate.messageKey === "string"
  );
}

export function toSessionOperationError(
  err: unknown,
  fallbackStage: SessionOperationStage = "ingestion",
  sessionId?: string,
): SessionOperationError {
  if (err instanceof RecordingSessionApiError) {
    return {
      code: err.code,
      stage: err.stage,
      sessionId: err.sessionId ?? sessionId,
      retryable: err.retryable,
      recoverableAssetId: err.recoverableAssetId,
      messageKey: err.messageKey,
    };
  }

  if (isSessionOperationError(err)) {
    return {
      ...err,
      sessionId: err.sessionId ?? sessionId,
    };
  }

  if (err && typeof err === "object") {
    const candidate = err as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.stage === "string") {
      return {
        code: candidate.code as SessionOperationErrorCode,
        stage: candidate.stage as SessionOperationStage,
        sessionId: (typeof candidate.sessionId === "string" ? candidate.sessionId : sessionId),
        retryable: typeof candidate.retryable === "boolean" ? candidate.retryable : false,
        recoverableAssetId: typeof candidate.recoverableAssetId === "string" ? candidate.recoverableAssetId : undefined,
        messageKey: typeof candidate.messageKey === "string" ? candidate.messageKey : "recording.sourceUnavailable",
      };
    }
  }

  if (err instanceof Error) {
    const match = err.message.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (isSessionOperationError(parsed)) {
          return {
            ...parsed,
            sessionId: parsed.sessionId ?? sessionId,
          };
        }
      } catch {
        // Fall through
      }
    }
  }

  return {
    code: "SourceUnavailable",
    stage: fallbackStage,
    sessionId,
    retryable: false,
    messageKey: "recording.sourceUnavailable",
  };
}

function typedUnavailableError(stage: SessionOperationStage = "ingestion", sessionId?: string): RecordingSessionApiError {
  return new RecordingSessionApiError({
    code: "SourceUnavailable",
    stage,
    sessionId,
    retryable: false,
    messageKey: "recording.sourceUnavailable",
  });
}

/** Check whether native recording-session persistence is supported in current runtime. */
export function isRecordingPersistenceAvailable(): boolean {
  return isTauri();
}

/**
 * Creates a new recording session, allocating or attaching the backing document
 * with authoritative local-only privacy. Idempotent on retried session ID.
 */
export async function createRecordingSession(request: CreateRecordingSession): Promise<RecordingSession> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", request.id);
  }
  try {
    return await invokeCommand<RecordingSession>("create_recording_session", { request });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", request.id));
  }
}

/**
 * Loads a recording session by ID, authorized by source document lookup.
 */
export async function getRecordingSession(id: string): Promise<RecordingSession> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", id);
  }
  try {
    return await invokeCommand<RecordingSession>("get_recording_session", { id });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", id));
  }
}

/**
 * Looks up a recording session associated with a document ID.
 */
export async function findSessionByDocumentId(
  documentId: string
): Promise<RecordingSession | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invokeCommand<RecordingSession | null>("find_session_by_document_id", {
      documentId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion"));
  }
}

/**
 * Loads a media asset for a session by asset ID.
 */
export async function getRecordingAsset(
  sessionId: string,
  assetId: string
): Promise<SessionMediaAsset> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<SessionMediaAsset>("get_recording_asset", {
      sessionId,
      assetId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Absolute path of the session's current media asset.
 *
 * Recording assets are stored as app-relative paths (for example
 * `recordings/<session>/audio.wav`); transcription needs a real filesystem
 * path. Throws when the session has no media or the asset is not a single file.
 */
export async function getRecordingMediaPath(sessionId: string): Promise<string> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<string>("get_recording_media_path", {
      sessionId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Looks up an existing recording session by its media asset SHA-256 hash.
 * If collectionId is provided, prioritizes a match within that collection.
 */
export async function findSessionByMediaHash(
  sha256: string,
  collectionId?: string,
): Promise<RecordingSession | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invokeCommand<RecordingSession | null>("find_session_by_media_hash", {
      sha256,
      collectionId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion"));
  }
}

/**
 * Lists recording sessions ordered newest first, with optional collection scoping and pagination.
 */
export async function listRecordingSessions(options?: {
  collectionId?: string;
  cursor?: string;
  limit?: number;
}): Promise<RecordingSessionPage> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion");
  }
  try {
    return await invokeCommand<RecordingSessionPage>("list_recording_sessions", {
      collectionId: options?.collectionId,
      cursor: options?.cursor,
      limit: options?.limit,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion"));
  }
}

/**
 * Updates content type and profile JSON with compare-and-swap on expected version.
 */
export async function updateRecordingSessionProfile(
  id: string,
  expectedVersion: number,
  contentType: string,
  profileJson: string,
): Promise<RecordingSession> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", id);
  }
  try {
    return await invokeCommand<RecordingSession>("update_recording_session_profile", {
      id,
      expectedVersion,
      contentType,
      profileJson,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", id));
  }
}

/**
 * Updates a recording session's overview JSON and overview revision.
 */
export async function updateRecordingSessionOverview(
  id: string,
  overviewJson: string,
  overviewRevision: number,
): Promise<RecordingSession> {
  if (!isTauri()) {
    throw typedUnavailableError("analysis", id);
  }
  try {
    return await invokeCommand<RecordingSession>("update_recording_session_overview", {
      id,
      overviewJson,
      overviewRevision,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis", id));
  }
}

/**
 * Retrieves ordered transcript segments for a session with optional pagination cursor and limit.
 */
export async function getSessionSegments(
  id: string,
  options?: { cursor?: string; limit?: number },
): Promise<SessionSegmentPage> {
  if (!isTauri()) {
    throw typedUnavailableError("transcription", id);
  }
  try {
    return await invokeCommand<SessionSegmentPage>("get_session_segments", {
      id,
      cursor: options?.cursor,
      limit: options?.limit,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "transcription", id));
  }
}

/**
 * Retrieves authoritative document privacy (local-only, AI-excluded, policy version)
 * for a recording session's source document.
 */
export async function getSessionDocumentPrivacy(id: string): Promise<SessionDocumentPrivacy> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", id);
  }
  try {
    return await invokeCommand<SessionDocumentPrivacy>("get_session_document_privacy", { id });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", id));
  }
}

/**
 * Appends a recorded part bounded to at most 4 MiB. Atomic write + manifest + SQLite.
 */
export async function appendRecordingPart(params: {
  sessionId: string;
  writerEpoch: string;
  sequence: number;
  startMs: number;
  durationMs: number;
  formatJson: string;
  bytes: Uint8Array | number[];
}): Promise<RecordingPart> {
  if (!isTauri()) {
    throw typedUnavailableError("capture", params.sessionId);
  }
  const payloadBytes = params.bytes instanceof Uint8Array ? Array.from(params.bytes) : params.bytes;
  try {
    return await invokeCommand<RecordingPart>("append_recording_part", {
      sessionId: params.sessionId,
      writerEpoch: params.writerEpoch,
      sequence: params.sequence,
      startMs: params.startMs,
      durationMs: params.durationMs,
      formatJson: params.formatJson,
      bytes: payloadBytes,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "capture", params.sessionId));
  }
}

/**
 * Finalizes a recording session: verifies manifest, marks media ready, CAS-updates session.
 */
export async function finalizeRecordingSession(
  id: string,
  expectedVersion: number,
): Promise<RecordingSession> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", id);
  }
  try {
    return await invokeCommand<RecordingSession>("finalize_recording_session", {
      id,
      expectedVersion,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", id));
  }
}

/**
 * Reconciles on-disk manifest and parts with SQLite and reports recovery status.
 */
export async function recoverRecordingSession(id: string): Promise<RecoveryReport> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", id);
  }
  try {
    return await invokeCommand<RecoveryReport>("recover_recording_session", { id });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", id));
  }
}

/**
 * Stages an external media file into managed recording storage and records media asset.
 */
export async function stageSessionMedia(
  sessionId: string,
  sourcePath: string,
  mime: string,
): Promise<SessionMediaAsset> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<SessionMediaAsset>("stage_session_media", {
      sessionId,
      sourcePath,
      mime,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Exports all verified parts of a session to a single contiguous file.
 */
export async function exportPartialRecording(
  sessionId: string,
  outputPath: string,
): Promise<number> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<number>("export_partial_recording", {
      sessionId,
      outputPath,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

export interface SessionTranscriptSegmentInput {
  segmentKey: string;
  ordinal: number;
  startMs?: number | null;
  endMs?: number | null;
  text: string;
  confidence?: number | null;
  wordsJson?: string | null;
  speakerId?: string | null;
  timingKind: "measured" | "imported" | "none";
  revision: number;
  metadataJson?: string | null;
}

/**
 * Commits a finished decode unit and updates checkpoint progress atomically in SQLite.
 */
export async function commitSessionUnit(
  jobId: string,
  sessionId: string,
  expectedCancelEpoch: number,
  leaseOwner: string,
  processedDurationMs: number,
  totalDurationMs: number | null,
  segments: SessionTranscriptSegmentInput[],
): Promise<number> {
  if (!isTauri()) {
    return Promise.resolve(segments.length);
  }
  try {
    return await invokeCommand<number>("commit_session_unit", {
      jobId,
      sessionId,
      expectedCancelEpoch,
      leaseOwner,
      processedDurationMs,
      totalDurationMs,
      segments,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "transcription", sessionId));
  }
}

/**
 * Imports an external transcript (SRT, VTT, TXT) atomically for a recording session,
 * allocating a new revision and projecting to document.content without requiring audio.
 */
export async function importSessionTranscript(
  sessionId: string,
  segments: SessionTranscriptSegmentInput[],
): Promise<number> {
  if (!isTauri()) {
    return Promise.resolve(segments.length);
  }
  try {
    return await invokeCommand<number>("import_session_transcript", {
      sessionId,
      segments,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Creates or extends a session capture marker (Important/Interesting, Confusing, Bookmark).
 * Repeated invocation within 5s extends the capture window up to 90s.
 */
export async function createSessionMarker(params: {
  sessionId: string;
  kind: SessionMarkerKind;
  mediaMs: number;
  windowMs?: number;
  note?: string;
}): Promise<RecordingSessionMarker> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", params.sessionId);
  }
  try {
    return await invokeCommand<RecordingSessionMarker>("create_session_marker", {
      sessionId: params.sessionId,
      kind: params.kind,
      mediaMs: params.mediaMs,
      windowMs: params.windowMs,
      note: params.note,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", params.sessionId));
  }
}

/**
 * Lists all capture markers for a session ordered by media timestamp.
 */
export async function listSessionMarkers(sessionId: string): Promise<RecordingSessionMarker[]> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<RecordingSessionMarker[]>("list_session_markers", {
      sessionId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Resolves pending capture markers against newly finalized canonical transcript segments.
 */
export async function resolveSessionMarkers(sessionId: string): Promise<RecordingSessionMarker[]> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<RecordingSessionMarker[]>("resolve_session_markers", {
      sessionId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Retrieves learning object sources for a target (card or extract).
 */
export async function getLearningObjectSources(
  targetKind: "card" | "extract",
  targetId: string
): Promise<LearningObjectSource[]> {
  if (!isTauri()) {
    return [];
  }
  return await invokeCommand<LearningObjectSource[]>("get_learning_object_sources", {
    targetKind,
    targetId,
  });
}

/**
 * Retrieves learning object sources for a recording session.
 */
export async function getSessionLearningObjectSources(
  sessionId: string
): Promise<LearningObjectSource[]> {
  if (!isTauri()) {
    return [];
  }
  return await invokeCommand<LearningObjectSource[]>("get_session_learning_object_sources", {
    sessionId,
  });
}

/**
 * Corrects a canonical transcript segment with optimistic revision control.
 * Returns the new transcript revision or throws StaleRevision if conflicted.
 */
export async function correctSessionSegment(
  sessionId: string,
  segmentKey: string,
  expectedRevision: number,
  text: string,
  splitMetadataJson?: string
): Promise<number> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<number>("correct_session_segment", {
      sessionId,
      segmentKey,
      expectedRevision,
      text,
      splitMetadataJson,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Creates or retrieves an idempotent session analysis run.
 */
export async function createSessionAnalysisRun(
  input: CreateSessionAnalysisRun
): Promise<SessionAnalysisRun> {
  if (!isTauri()) {
    throw typedUnavailableError("analysis", input.sessionId);
  }
  try {
    return await invokeCommand<SessionAnalysisRun>("create_session_analysis_run", { input });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis", input.sessionId));
  }
}

/**
 * Retrieves a session analysis run by ID.
 */
export async function getSessionAnalysisRun(
  runId: string
): Promise<SessionAnalysisRun | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invokeCommand<SessionAnalysisRun | null>("get_session_analysis_run", { runId });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis"));
  }
}

/**
 * Checkpoints a session analysis unit with deterministic status and result.
 */
export async function upsertSessionAnalysisUnit(
  input: UpsertSessionAnalysisUnit
): Promise<SessionAnalysisUnit> {
  if (!isTauri()) {
    throw typedUnavailableError("analysis", input.runId);
  }
  try {
    return await invokeCommand<SessionAnalysisUnit>("upsert_session_analysis_unit", { input });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis"));
  }
}

/**
 * Lists all analysis units for a run.
 */
export async function listSessionAnalysisUnits(
  runId: string
): Promise<SessionAnalysisUnit[]> {
  if (!isTauri()) {
    return [];
  }
  try {
    return await invokeCommand<SessionAnalysisUnit[]>("list_session_analysis_units", { runId });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis"));
  }
}

/**
 * Persists a learning draft into safe staging without activating learning items.
 */
export async function createSessionLearningDraft(
  input: CreateSessionLearningDraft
): Promise<PersistedSessionLearningDraft> {
  if (!isTauri()) {
    throw typedUnavailableError("analysis", input.sessionId);
  }
  try {
    return await invokeCommand<PersistedSessionLearningDraft>("create_session_learning_draft", {
      input,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis", input.sessionId));
  }
}

/**
 * Retrieves a single learning draft by ID.
 */
export async function getSessionLearningDraft(
  draftId: string
): Promise<PersistedSessionLearningDraft | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    return await invokeCommand<PersistedSessionLearningDraft | null>("get_session_learning_draft", {
      draftId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis"));
  }
}

/**
 * Lists paginated learning drafts for a session with optional status/kind filters.
 */
export async function listSessionLearningDrafts(
  sessionId: string,
  options?: {
    status?: string;
    kind?: string;
    cursor?: string;
    limit?: number;
  }
): Promise<SessionLearningDraftPage> {
  if (!isTauri()) {
    return { items: [], total: 0 };
  }
  try {
    return await invokeCommand<SessionLearningDraftPage>("list_session_learning_drafts", {
      sessionId,
      status: options?.status,
      kind: options?.kind,
      cursor: options?.cursor,
      limit: options?.limit,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "analysis", sessionId));
  }
}

/**
 * Updates a learning draft with optimistic revision control.
 */
export async function updateSessionLearningDraft(
  update: UpdateSessionLearningDraft
): Promise<PersistedSessionLearningDraft> {
  if (!isTauri()) {
    throw typedUnavailableError("approval");
  }
  try {
    return await invokeCommand<PersistedSessionLearningDraft>("update_session_learning_draft", {
      update,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "approval"));
  }
}

/**
 * Explicitly marks session drafts as rejected without touching review tables.
 */
export async function rejectSessionLearningDrafts(
  sessionId: string,
  draftIds: string[]
): Promise<number> {
  if (!isTauri()) {
    throw typedUnavailableError("approval", sessionId);
  }
  try {
    return await invokeCommand<number>("reject_session_learning_drafts", {
      sessionId,
      draftIds,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "approval", sessionId));
  }
}

/**
 * Atomically accepts learning drafts into normal library cards and extracts
 * with required source association and AI provenance in one transaction.
 */
export async function acceptSessionDrafts(
  input: AcceptSessionDraftsInput
): Promise<AcceptSessionDraftsResponse> {
  if (!isTauri()) {
    throw typedUnavailableError("approval", input.sessionId);
  }
  try {
    return await invokeCommand<AcceptSessionDraftsResponse>("accept_session_drafts", {
      input,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "approval", input.sessionId));
  }
}

/**
 * Explicitly deletes media assets for a session while preserving transcript,
 * markers, drafts, and accepted cards.
 */
export async function deleteSessionMedia(
  sessionId: string,
  expectedVersion: number
): Promise<DeleteSessionMediaResult> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<DeleteSessionMediaResult>("delete_session_media", {
      sessionId,
      expectedVersion,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Explicitly deletes a recording session and its media files.
 * Preserves accepted flashcards and learning objects with source snapshot.
 */
export async function deleteRecordingSession(
  sessionId: string,
  expectedVersion: number,
  deleteDocument?: boolean
): Promise<DeleteRecordingSessionResult> {
  if (!isTauri()) {
    throw typedUnavailableError("ingestion", sessionId);
  }
  try {
    return await invokeCommand<DeleteRecordingSessionResult>("delete_recording_session", {
      sessionId,
      expectedVersion,
      deleteDocument: deleteDocument ?? false,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Processes pending or failed entries in the recording filesystem cleanup journal.
 */
export async function processCleanupJournal(): Promise<CleanupJournalResult> {
  if (!isTauri()) {
    return { cleanedCount: 0, failedCount: 0 };
  }
  try {
    return await invokeCommand<CleanupJournalResult>("process_cleanup_journal", {});
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion"));
  }
}

/**
 * Renames or merges a speaker across all segments in a session.
 */
export async function updateSessionSpeaker(
  sessionId: string,
  fromSpeakerId: string,
  toSpeakerId: string | null
): Promise<number> {
  if (!isTauri()) {
    throw typedUnavailableError("transcription", sessionId);
  }
  try {
    return await invokeCommand<number>("update_session_speaker", {
      sessionId,
      fromSpeakerId,
      toSpeakerId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "transcription", sessionId));
  }
}

/**
 * Lists distinct speaker IDs appearing in session transcript segments.
 */
export async function listSessionSpeakers(sessionId: string): Promise<string[]> {
  if (!isTauri()) {
    return [];
  }
  try {
    return await invokeCommand<string[]>("list_session_speakers", {
      sessionId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "transcription", sessionId));
  }
}

/**
 * Associates a library document (slides, PDF, reading) with a session's metadata.
 */
export async function associateSessionDocument(
  sessionId: string,
  documentId: string
): Promise<SessionRelatedDocument[]> {
  if (!isTauri()) {
    return [];
  }
  try {
    return await invokeCommand<SessionRelatedDocument[]>("associate_session_document", {
      sessionId,
      documentId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Disassociates a library document from a session.
 */
export async function disassociateSessionDocument(
  sessionId: string,
  documentId: string
): Promise<SessionRelatedDocument[]> {
  if (!isTauri()) {
    return [];
  }
  try {
    return await invokeCommand<SessionRelatedDocument[]>("disassociate_session_document", {
      sessionId,
      documentId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}

/**
 * Lists related library materials associated with a session.
 */
export async function listSessionRelatedDocuments(
  sessionId: string
): Promise<SessionRelatedDocument[]> {
  if (!isTauri()) {
    return [];
  }
  try {
    return await invokeCommand<SessionRelatedDocument[]>("list_session_related_documents", {
      sessionId,
    });
  } catch (err) {
    throw new RecordingSessionApiError(toSessionOperationError(err, "ingestion", sessionId));
  }
}
