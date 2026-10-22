/**
 * Shared Session Controller (Task 1.1 / OpenSpec D1, D6).
 *
 * Unified orchestration facade for all session origins:
 * - "recorded": microphone / desktop / mobile disk-backed capture.
 * - "file": audio / video media file import.
 * - "transcript": transcript-first or cue-linked sessions.
 * - "url": remote media source.
 *
 * Guarantees:
 * - All origins converge after durable save to finalizeIngestion(sessionId).
 * - Create -> Stage/Save -> Probe -> Reuse transcript or Enqueue STT -> Analysis placeholder.
 * - Independent stage states (media, transcription, analysis).
 * - Provider failure retains media asset (never discards audio on downstream error).
 * - Session ID and backing Document ID never change across retries.
 * - No inference triggered on mount.
 */

import {
  createRecordingSession,
  finalizeRecordingSession,
  getRecordingMediaPath,
  getRecordingSession,
  stageSessionMedia,
  deleteSessionMedia,
  deleteRecordingSession,
  type CreateRecordingSession,
  type SessionTranscriptSegmentInput,
} from "../../api/recordingSessions";
import { getDocumentPrivacy } from "../../lib/documentPrivacy";
import { generateId } from "../../utils/id";
import { useRecordingSessionStore } from "../../stores/recordingSessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type {
  RecordingSession,
  SessionContentType,
  SessionMediaAsset,
  SessionOrigin,
} from "../../types/recordingSession";
import { TranscriptionJobManager } from "../transcription/jobs/TranscriptionJobManager";
import type {
  SessionExecutor,
  SessionTranscriptionAuthorization,
  SessionTranscriptionPlan,
} from "../transcription/types";

export interface CreateSessionOptions {
  sessionId?: string;
  documentId?: string;
  collectionId?: string;
  title: string;
  origin?: SessionOrigin;
  contentType?: SessionContentType | string;
  profileJson?: string;
}

export interface SessionProcessingSelection {
  transcribe?: boolean;
  provider?: "local" | "android-ondevice" | "apple" | "groq" | "openrouter";
  modelId?: string;
  language?: string;
  prepareSuggestions?: boolean;
  profileId?: string;
  authorization?: SessionTranscriptionAuthorization;
}

export interface FinalizeIngestionInput {
  sessionId: string;
  expectedVersion?: number;
  transcriptSegments?: SessionTranscriptSegmentInput[];
  transcriptText?: string;
  processingSelection?: SessionProcessingSelection;
}

export interface FinalizeIngestionResult {
  session: RecordingSession;
  mediaAsset: SessionMediaAsset | null;
  stageStates: {
    media: "saved" | "partial" | "missing";
    transcription: "queued" | "reused" | "skipped" | "failed";
    analysis: "idle" | "queued" | "skipped";
  };
  transcriptionJobId?: string;
}

export class SessionController {
  private static instance: SessionController | null = null;
  private jobManager: TranscriptionJobManager;

  constructor(jobManager: TranscriptionJobManager = new TranscriptionJobManager()) {
    this.jobManager = jobManager;
  }

  static getInstance(): SessionController {
    if (!SessionController.instance) {
      SessionController.instance = new SessionController();
    }
    return SessionController.instance;
  }

  /**
   * Allocates a recording session with stable session and document IDs.
   * Idempotent on retried session ID.
   */
  async createSession(options: CreateSessionOptions): Promise<RecordingSession> {
    const sessionId = options.sessionId || generateId();

    const payload: CreateRecordingSession = {
      id: sessionId,
      documentId: options.documentId,
      collectionId: options.collectionId,
      title: options.title,
      origin: options.origin ?? "recorded",
      contentType: options.contentType ?? "lecture",
      profileJson: options.profileJson ?? "{}",
    };

    const session = await createRecordingSession(payload);

    // Keep store in sync if active session is unset or matches
    const store = useRecordingSessionStore.getState();
    if (!store.activeSessionId || store.activeSessionId === session.id) {
      store.setActiveSession(session.id, session.mediaAssetId);
    }

    return session;
  }

  /**
   * Stages an external media file into private managed storage and registers media asset.
   */
  async stageMedia(
    sessionId: string,
    sourcePath: string,
    mime = "audio/wav"
  ): Promise<SessionMediaAsset> {
    const asset = await stageSessionMedia(sessionId, sourcePath, mime);
    return asset;
  }

  /**
   * Loads a recording session by ID.
   */
  async getSession(sessionId: string): Promise<RecordingSession> {
    return getRecordingSession(sessionId);
  }

  /**
   * Central convergence point for all session origins.
   * Probes durable save state, reuses or enqueues transcription, and sets analysis placeholder.
   */
  async finalizeIngestion(input: FinalizeIngestionInput): Promise<FinalizeIngestionResult> {
    let session = await this.getSession(input.sessionId);

    // 1. Finalize session if still in recording or staging state
    if (session.captureState === "recording" || session.ingestionState === "staging") {
      try {
        session = await finalizeRecordingSession(
          session.id,
          input.expectedVersion ?? session.version
        );
      } catch {
        // If already finalized or CAS-conflict, reload latest state
        session = await this.getSession(input.sessionId);
      }
    }

    // 2. Evaluate Media State
    let mediaState: "saved" | "partial" | "missing" = "missing";
    if (!session.mediaAssetId) {
      mediaState = "missing";
    } else if (session.ingestionState === "saved" || session.captureState === "saved") {
      mediaState = "saved";
    } else if (session.ingestionState === "partial" || session.captureState === "recoverable") {
      mediaState = "partial";
    } else {
      mediaState = "saved";
    }

    // 3. Evaluate Transcription: Reuse vs Enqueue
    let transcriptionState: "queued" | "reused" | "skipped" | "failed" = "skipped";
    let transcriptionJobId: string | undefined;

    const hasSuppliedSegments =
      input.transcriptSegments && input.transcriptSegments.length > 0;
    const hasExistingTranscript =
      session.transcriptRevision > 0 && session.transcriptId !== null;

    if (hasSuppliedSegments || hasExistingTranscript) {
      // Transcript is already present or imported
      transcriptionState = "reused";
    } else if (
      mediaState !== "missing" &&
      input.processingSelection?.transcribe !== false
    ) {
      // Audio is ready, enqueue transcription via TranscriptionJobManager
      try {
        const privacy = await getDocumentPrivacy(session.documentId);
        const provider = input.processingSelection?.provider ?? "local";
        const isLocal =
          provider === "local" ||
          provider === "apple" ||
          provider === "android-ondevice";

        let executor: SessionExecutor = "frontend-service";
        if (provider === "local") executor = "rust-local";
        else if (provider === "android-ondevice") executor = "native-android";
        else if (provider === "apple") executor = "native-apple";

        // Resolve the session's actual media file (consolidated `audio.wav` for
        // recordings, the staged file for imports). The old hardcoded
        // `audio.wav` path did not exist for native captures and ignored
        // imported media entirely.
        const audioPath = await getRecordingMediaPath(session.id);

        const plan: SessionTranscriptionPlan = {
          sessionId: session.id,
          assetId: session.mediaAssetId ?? undefined,
          transcriptRevision: (session.transcriptRevision ?? 0) + 1,
          provider,
          modelId: input.processingSelection?.modelId ?? "distil-small.en",
          modelLabel: provider === "local" ? "Local Whisper" : provider,
          language: input.processingSelection?.language ?? "en",
          executor,
          isLocal,
          sourceRevision: session.version,
          privacyCategory: privacy.isLocalOnly
            ? "local-only"
            : !isLocal
            ? "cloud-authorized"
            : "standard",
          frozenAt: new Date().toISOString(),
        };

        const job = await this.jobManager.startSessionJob({
          sessionId: session.id,
          documentId: session.documentId,
          assetId: session.mediaAssetId ?? undefined,
          audioPath,
          transcriptRevision: plan.transcriptRevision,
          plan,
          authorization: input.processingSelection?.authorization,
        });

        transcriptionState = "queued";
        transcriptionJobId = job?.id;
      } catch (err) {
        // Provider failure retains the audio asset! Audio remains saved/partial.
        console.warn("[SessionController] Transcription enqueue failed:", err);
        transcriptionState = "failed";
      }
    } else {
      transcriptionState = "skipped";
    }

    // 4. Analysis Placeholder
    const suggestionsEnabled =
      useSettingsStore.getState().settings.features.sessionLearningSuggestions;
    let analysisState: "idle" | "queued" | "skipped" = "idle";
    if (input.processingSelection?.prepareSuggestions && suggestionsEnabled) {
      // Placeholder: no inference triggered on mount, queued for background run
      analysisState = "queued";
    } else {
      analysisState = suggestionsEnabled ? "idle" : "skipped";
    }

    return {
      session,
      mediaAsset: null,
      stageStates: {
        media: mediaState,
        transcription: transcriptionState,
        analysis: analysisState,
      },
      transcriptionJobId,
    };
  }

  /**
   * Retries ingestion on an existing session. Session and document IDs are preserved.
   */
  async retryIngestion(
    sessionId: string,
    processingSelection?: SessionProcessingSelection
  ): Promise<FinalizeIngestionResult> {
    return this.finalizeIngestion({
      sessionId,
      processingSelection,
    });
  }

  /**
   * Deletes session media while preserving transcript and learning objects.
   */
  async deleteMedia(sessionId: string, expectedVersion: number) {
    return await deleteSessionMedia(sessionId, expectedVersion);
  }

  /**
   * Deletes a recording session. Accepted cards and learning objects remain preserved.
   */
  async deleteSession(sessionId: string, expectedVersion: number, deleteDocument?: boolean) {
    return await deleteRecordingSession(sessionId, expectedVersion, deleteDocument);
  }
}

export const sessionController = SessionController.getInstance();
