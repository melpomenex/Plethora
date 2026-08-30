import { isLocalNemotronInstalled, transcribeLocalNemotron } from "../../../api/transcription";
import { isTauri } from "../../../lib/tauri";
import { LOGICAL_STT_MODEL_KEYS, TRANSCRIPTION_PROVIDER_IDS } from "../config";
import { normalizeError, TranscriptionError } from "../errors";
import { canRunLocalNemotron, classifyDevice } from "../DeviceCapabilityService";
import type {
  StreamingTranscriptionSession,
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSegment,
} from "../types";
import { BaseProvider } from "./BaseProvider";

export class LocalNemotronProvider extends BaseProvider {
  readonly id: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON;
  readonly name = "Local Nemotron 3.5 ASR";

  capabilities(): TranscriptionCapabilities {
    return {
      fileTranscription: true,
      streaming: true,
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
    const installed = isTauri() ? await isLocalNemotronInstalled() : false;
    const capable = canRunLocalNemotron();
    return {
      healthy: installed && capable,
      message: !isTauri()
        ? "Local Nemotron requires the native app"
        : !capable
          ? `Device performance is ${classifyDevice()} — local Nemotron is not recommended`
          : installed
            ? undefined
            : "Local Nemotron model is not installed",
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
        "Local Nemotron transcription requires the native app.",
        "PROVIDER_UNAVAILABLE",
        { providerId: this.id },
      );
    }

    if (!canRunLocalNemotron()) {
      throw new TranscriptionError(
        "This device does not meet the performance requirements for local Nemotron ASR.",
        "PROVIDER_UNAVAILABLE",
        { providerId: this.id },
      );
    }

    if (!input.filePath) {
      throw new TranscriptionError(
        "Local Nemotron transcription requires filePath.",
        "INVALID_INPUT",
        { providerId: this.id },
      );
    }

    const installed = await isLocalNemotronInstalled();
    if (!installed) {
      throw new TranscriptionError(
        "Local Nemotron ASR is not installed. Install it from Local Models or use cloud OpenRouter Nemotron.",
        "LOCAL_MODEL_MISSING",
        { providerId: this.id },
      );
    }

    const language = options.language || "en";

    try {
      options.onProgress?.({ percent: 10, message: "Starting local Nemotron transcription…" });
      const response = await transcribeLocalNemotron(input.filePath, language);
      options.onProgress?.({ percent: 100, message: "Local Nemotron transcription complete" });

      const segments: TranscriptionSegment[] = response.segments.map((segment) => ({
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        text: segment.text,
        confidence: segment.confidence,
      }));

      const lastSegment = segments[segments.length - 1];
      return {
        text: segments.map((segment) => segment.text).join(" "),
        segments,
        durationSeconds: lastSegment ? lastSegment.endMs / 1000 : undefined,
        providerId: this.id,
        model: LOGICAL_STT_MODEL_KEYS.NEMOTRON,
        metadata: { source: "local-nemotron" },
      };
    } catch (error) {
      throw normalizeError(error, this.id);
    }
  }

  async startStreaming(
    input: TranscriptionInput,
    options: TranscriptionOptions,
  ): Promise<StreamingTranscriptionSession> {
    const { LocalNemotronStreamingSession } = await import(
      "../streaming/LocalNemotronStreamingSession"
    );
    return new LocalNemotronStreamingSession(this, input.filePath, options.language);
  }
}
