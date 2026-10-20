/**
 * API client for Recording Sessions, canonical transcripts, and document privacy.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  CreateRecordingSession,
  RecordingPart,
  RecordingSession,
  RecordingSessionPage,
  RecoveryReport,
  SessionDocumentPrivacy,
  SessionMediaAsset,
  SessionOperationError,
  SessionOperationErrorCode,
  SessionOperationStage,
  SessionSegmentPage,
} from "../types/recordingSession";

export type {
  CreateRecordingSession,
  RecordingPart,
  RecordingSession,
  RecordingSessionPage,
  RecoveryReport,
  SessionDocumentPrivacy,
  SessionMediaAsset,
  SessionOperationError,
  SessionOperationErrorCode,
  SessionOperationStage,
  SessionSegmentPage,
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

