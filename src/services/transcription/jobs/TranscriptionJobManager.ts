import { enqueueAutoTranscription, getTranscriptionStatus } from "../../../api/transcription";
import { isTauri } from "../../../lib/tauri";
import { useSettingsStore } from "../../../stores/settingsStore";
import { resolveTranscriptionMode } from "../config";
import { estimateCost } from "../pricing";
import { mergeChunkedTranscriptionResults } from "../reconciliation";
import { persistTranscriptionResult } from "../persist";
import { getTranscriptionService, TranscriptionMode } from "../index";
import type { TranscriptionResult } from "../types";
import type { StartTranscriptionJobInput, TranscriptionJobProgressView } from "./types";

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
      status: entry.status,
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
