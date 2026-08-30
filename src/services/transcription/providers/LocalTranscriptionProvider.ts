import { getTranscriptionProfiles } from "../../../api/transcription";
import {
  generateVideoTranscript,
  getVideoTranscript,
  type VideoTranscriptSegment,
} from "../../../api/video-extracts";
import { isTauri } from "../../../lib/tauri";
import {
  enqueueVideoTranscription,
  getVideoTranscriptionStatus,
  subscribeVideoTranscriptionStatus,
} from "../../../lib/videoTranscriptionQueue";
import { useSettingsStore } from "../../../stores/settingsStore";
import { TRANSCRIPTION_PROVIDER_IDS } from "../config";
import { normalizeError, TranscriptionError } from "../errors";
import type {
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSegment,
} from "../types";
import { BaseProvider } from "./BaseProvider";

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

/** Coalesce parallel transcribe calls for the same document into one enqueue/wait cycle. */
const inFlightLocalJobs = new Map<string, Promise<void>>();

async function ensureLocalTranscriptionQueued(
  documentId: string,
  filePath: string,
  modelId: string,
  language: string,
  signal: AbortSignal | undefined,
  onProgress: TranscriptionOptions["onProgress"],
): Promise<void> {
  const existingJob = inFlightLocalJobs.get(documentId);
  if (existingJob) {
    await existingJob;
    return;
  }

  const job = (async () => {
    const transcript = await getVideoTranscript(documentId);
    if (transcript?.segments?.length) return;

    const currentStatus = getVideoTranscriptionStatus(documentId);
    if (currentStatus !== "queued" && currentStatus !== "processing") {
      await enqueueVideoTranscription({
        documentId,
        filePath,
        provider: "local",
        modelId,
        language,
      });
      onProgress?.({ percent: 5, message: "Queued local transcription…" });
    }

    await waitForQueueCompletion(documentId, signal, onProgress);
  })();

  inFlightLocalJobs.set(documentId, job);
  try {
    await job;
  } finally {
    if (inFlightLocalJobs.get(documentId) === job) {
      inFlightLocalJobs.delete(documentId);
    }
  }
}

function mapVideoSegments(segments: VideoTranscriptSegment[]): TranscriptionSegment[] {
  return segments.map((segment, index) => {
    const startMs = Math.round(segment.time * 1000);
    const next = segments[index + 1];
    const endMs = next ? Math.round(next.time * 1000) : startMs + 1000;
    return {
      startMs,
      endMs,
      text: segment.text,
    };
  });
}

async function resolveInstalledModelId(requestedModelId?: string): Promise<string | null> {
  try {
    const profiles = await getTranscriptionProfiles();
    const installed = profiles.filter((profile) => profile.installed);
    if (installed.length === 0) return null;

    if (requestedModelId) {
      const match = installed.find((profile) => profile.id === requestedModelId);
      return match ? match.id : null;
    }

    const settings = useSettingsStore.getState().settings.audioTranscription;
    if (settings.preferredModelId) {
      const preferred = installed.find((profile) => profile.id === settings.preferredModelId);
      if (preferred) return preferred.id;
    }

    const distil = installed.find((profile) => profile.id === "distil-small.en");
    return distil ? distil.id : installed[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function waitForQueueCompletion(
  documentId: string,
  signal?: AbortSignal,
  onProgress?: TranscriptionOptions["onProgress"],
): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearInterval(pollTimer);
      if (error) reject(error);
      else resolve();
    };

    const unsubscribe = subscribeVideoTranscriptionStatus(documentId, (status) => {
      if (status === "completed") {
        onProgress?.({ percent: 100, message: "Local transcription complete" });
        finish();
        return;
      }
      if (status === "failed" || status === "needs-model" || status === "needs-api-key") {
        finish(
          new TranscriptionError(
            status === "needs-model"
              ? "No local transcription model is installed."
              : "Local transcription failed.",
            status === "needs-model" ? "LOCAL_MODEL_MISSING" : "UNKNOWN",
            { providerId: TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER },
          ),
        );
      }
    });

    const pollTimer = setInterval(() => {
      if (signal?.aborted) {
        finish(new DOMException("Transcription was cancelled.", "AbortError"));
        return;
      }
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        finish(new TranscriptionError("Local transcription timed out.", "TIMEOUT", {
          providerId: TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER,
          recoverable: true,
        }));
        return;
      }

      const status = getVideoTranscriptionStatus(documentId);
      if (status === "processing") {
        onProgress?.({ percent: 50, message: "Transcribing locally…" });
      }
    }, POLL_INTERVAL_MS);
  });
}

export class LocalTranscriptionProvider extends BaseProvider {
  readonly id: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER;
  readonly name = "Local Whisper";

  capabilities(): TranscriptionCapabilities {
    return {
      fileTranscription: true,
      streaming: false,
      pseudoStreaming: false,
      segmentTimestamps: true,
      wordTimestamps: false,
      diarization: false,
      languageDetection: false,
      customVocabulary: false,
      offline: true,
      supportedLanguages: "auto",
    };
  }

  async healthCheck() {
    const modelId = await resolveInstalledModelId();
    return {
      healthy: isTauri() && modelId !== null,
      message: !isTauri()
        ? "Local transcription requires the desktop app"
        : modelId
          ? undefined
          : "No local transcription model installed",
      checkedAt: Date.now(),
    };
  }

  async transcribe(
    input: TranscriptionInput,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    this.assertNotAborted(options.signal);

    if (!isTauri()) {
      throw new TranscriptionError(
        "Local transcription requires the desktop app.",
        "PROVIDER_UNAVAILABLE",
        { providerId: this.id },
      );
    }

    if (!input.documentId || !input.filePath) {
      throw new TranscriptionError(
        "Local transcription requires documentId and filePath.",
        "INVALID_INPUT",
        { providerId: this.id },
      );
    }

    const modelId = await resolveInstalledModelId(options.modelId);
    if (!modelId) {
      throw new TranscriptionError(
        "No local transcription model is installed.",
        "LOCAL_MODEL_MISSING",
        { providerId: this.id },
      );
    }

    const language =
      options.language ||
      useSettingsStore.getState().settings.audioTranscription.language ||
      "en";

    const documentId = input.documentId;

    try {
      await ensureLocalTranscriptionQueued(
        documentId,
        input.filePath,
        modelId,
        language,
        options.signal,
        options.onProgress,
      );

      let transcript = await getVideoTranscript(input.documentId);
      if (!transcript?.segments?.length) {
        await generateVideoTranscript(input.documentId, input.filePath, modelId, language);
        transcript = await getVideoTranscript(input.documentId);
      }

      if (!transcript?.segments?.length) {
        throw new TranscriptionError(
          "Local transcription produced no segments.",
          "UNKNOWN",
          { providerId: this.id },
        );
      }

      return this.toResult(transcript.transcript, transcript.segments, modelId);
    } catch (error) {
      throw normalizeError(error, this.id);
    }
  }

  private toResult(
    text: string,
    segments: VideoTranscriptSegment[],
    modelId: string,
  ): TranscriptionResult {
    const normalizedSegments = mapVideoSegments(segments);
    const lastSegment = normalizedSegments[normalizedSegments.length - 1];
    return {
      text: text || normalizedSegments.map((segment) => segment.text).join(" "),
      segments: normalizedSegments,
      durationSeconds: lastSegment ? lastSegment.endMs / 1000 : undefined,
      providerId: this.id,
      model: modelId,
      metadata: { source: "local-whisper" },
    };
  }
}
