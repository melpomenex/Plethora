import {
  enqueueAutoTranscription,
  enqueueSessionTranscription,
  getTranscriptionStatus,
  getSessionTranscriptionStatus,
} from "../../../api/transcription";
import type { TranscriptionQueueEntry } from "../../../api/transcription";
import { isTauri } from "../../../lib/tauri";
import { useSettingsStore } from "../../../stores/settingsStore";
import { resolveTranscriptionMode } from "../config";
import { estimateCost } from "../pricing";
import { mergeChunkedTranscriptionResults } from "../reconciliation";
import { persistTranscriptionResult } from "../persist";
import { getTranscriptionService, TranscriptionMode } from "../index";
import type { TranscriptionResult } from "../types";
import type {
  StartTranscriptionJobInput,
  StartSessionJobInput,
  TranscriptionJobProgressView,
} from "./types";
import { getDocumentPrivacy } from "../../../lib/documentPrivacy";

function modeToQueueProvider(mode: TranscriptionMode): string {
  if (mode === TranscriptionMode.Offline) return "local";
  return "cloud";
}

function resolveModelId(settings = useSettingsStore.getState().settings.audioTranscription): string {
  return settings.preferredModelId || "distil-small.en";
}

export class TranscriptionJobManager {
  async startJob(input: StartTranscriptionJobInput): Promise<void> {
    if (input.chunkResults && input.chunkResults.length > 0) {
      const merged = mergeChunkedTranscriptionResults(input.chunkResults);
      await persistTranscriptionResult(input.documentId, merged);
      return;
    }

    const settings = useSettingsStore.getState().settings.audioTranscription;
    const mode = input.mode ?? resolveTranscriptionMode(settings);
    const language = input.language || settings.language || "en";

    if (mode === TranscriptionMode.Offline || input.queueProvider === "local") {
      if (!isTauri() || !input.filePath) {
        throw new Error("Offline transcription requires a desktop file path.");
      }
      await enqueueAutoTranscription(
        input.documentId,
        input.filePath,
        "local",
        input.modelId || resolveModelId(settings),
        language,
        undefined,
        input.chapterId,
        mode,
      );
      return;
    }

    if (isTauri() && input.filePath) {
      await enqueueAutoTranscription(
        input.documentId,
        input.filePath,
        input.queueProvider || modeToQueueProvider(mode),
        input.modelId || settings.groq.model,
        language,
        undefined,
        input.chapterId,
        mode,
      );
      return;
    }

    const result = await getTranscriptionService().transcribe(
      {
        file: input.file,
        url: input.url,
        filePath: input.filePath,
        documentId: input.documentId,
      },
      { mode, language },
    );

    await persistTranscriptionResult(input.documentId, result);
  }

  /**
   * Start or enqueue an authorized session transcription job (Task 0.11 / OpenSpec D6).
   * This is the only authorized session transcription start route.
   */
  async startSessionJob(input: StartSessionJobInput): Promise<TranscriptionQueueEntry> {
    const privacy = await getDocumentPrivacy(input.documentId);
    if (privacy.isLocalOnly && !input.plan.isLocal) {
      throw new Error("Cannot dispatch cloud transcription for a local-only document.");
    }
    if (privacy.isAiExcluded && !input.plan.isLocal) {
      throw new Error("Cannot dispatch cloud transcription for an AI-excluded document.");
    }
    if (!input.plan.isLocal && (!input.authorization || !input.authorization.userConsented)) {
      throw new Error("Consent required for remote session transcription.");
    }

    if (isTauri()) {
      return enqueueSessionTranscription({
        sessionId: input.sessionId,
        documentId: input.documentId,
        assetId: input.assetId,
        audioPath: input.audioPath,
        transcriptRevision: input.transcriptRevision,
        provider: input.plan.provider,
        modelId: input.plan.modelId,
        language: input.plan.language,
        executor: input.plan.executor,
        planJson: JSON.stringify(input.plan),
        authorizationJson: input.authorization ? JSON.stringify(input.authorization) : undefined,
        priority: input.priority,
      });
    }

    return {
      id: `session-job-${input.sessionId}-${input.transcriptRevision}`,
      documentId: input.documentId,
      chapterId: null,
      audioPath: input.audioPath,
      provider: input.plan.provider,
      modelId: input.plan.modelId,
      language: input.plan.language,
      status: "pending",
      errorMessage: null,
      priority: input.priority ?? 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      progress: 0,
      sessionId: input.sessionId,
      assetId: input.assetId,
      transcriptRevision: input.transcriptRevision,
      executor: input.plan.executor,
      planJson: JSON.stringify(input.plan),
      authorizationJson: input.authorization ? JSON.stringify(input.authorization) : null,
      cancelEpoch: 0,
    };
  }

  /**
   * Orchestrate long-form transcription by invoking the service per chunk and
   * merging via reconciliation before a single persist (Phase 6).
   */
  async startChunkedJob(
    input: StartTranscriptionJobInput & { chunkCount: number; durationSeconds: number },
  ): Promise<void> {
    const { chunkCount, durationSeconds, ...base } = input;
    const chunkDuration = durationSeconds / Math.max(1, chunkCount);
    const results: TranscriptionResult[] = [];

    for (let index = 0; index < chunkCount; index += 1) {
      const result = await getTranscriptionService().transcribe(
        {
          file: base.file,
          url: base.url,
          filePath: base.filePath,
          documentId: base.documentId,
          durationSeconds: chunkDuration,
        },
        {
          mode: base.mode,
          language: base.language,
        },
      );
      results.push({
        ...result,
        durationSeconds: chunkDuration,
        durationMs: chunkDuration * 1000,
      });
    }

    await this.startJob({ ...base, chunkResults: results });
  }

  async getProgress(documentId: string): Promise<TranscriptionJobProgressView | null> {
    if (!isTauri()) return null;

    const entry = await getTranscriptionStatus(documentId);
    if (!entry) return null;

    const processedDurationMs = entry.processedDurationMs ?? undefined;
    const totalDurationMs = entry.totalDurationMs ?? undefined;
    const providerId = entry.provider;
    const durationSeconds = totalDurationMs ? totalDurationMs / 1000 : 0;

    return {
      documentId,
      status: entry.status === "pending" ? "queued" : entry.status,
      percent: entry.progress,
      processedDurationMs,
      totalDurationMs,
      estimatedCostUsd: durationSeconds > 0 ? estimateCost(durationSeconds, providerId) : undefined,
      providerId,
      mode: (entry.transcriptionMode as TranscriptionMode) || undefined,
    };
  }

  async getSessionProgress(
    sessionId: string,
    revision: number,
  ): Promise<TranscriptionJobProgressView | null> {
    if (!isTauri()) return null;

    const entry = await getSessionTranscriptionStatus(sessionId, revision);
    if (!entry) return null;

    const processedDurationMs = entry.processedDurationMs ?? undefined;
    const totalDurationMs = entry.totalDurationMs ?? undefined;
    const providerId = entry.provider;
    const durationSeconds = totalDurationMs ? totalDurationMs / 1000 : 0;

    return {
      documentId: entry.documentId,
      sessionId,
      transcriptRevision: revision,
      status: entry.status === "pending" ? "queued" : entry.status,
      percent: entry.progress,
      processedDurationMs,
      totalDurationMs,
      estimatedCostUsd: durationSeconds > 0 ? estimateCost(durationSeconds, providerId) : undefined,
      providerId,
      mode: (entry.transcriptionMode as TranscriptionMode) || undefined,
    };
  }
}

let defaultManager: TranscriptionJobManager | undefined;

export function getTranscriptionJobManager(): TranscriptionJobManager {
  if (!defaultManager) {
    defaultManager = new TranscriptionJobManager();
  }
  return defaultManager;
}
