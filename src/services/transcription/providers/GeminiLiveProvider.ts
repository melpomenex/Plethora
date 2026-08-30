import { generateId } from "../../../utils/id";
import { useSettingsStore } from "../../../stores/settingsStore";
import {
  GEMINI_LIVE_MODEL,
  TRANSCRIPTION_PROVIDER_IDS,
} from "../config";
import { normalizeError, TranscriptionError } from "../errors";
import {
  checkPremiumTranscriptionAllowed,
} from "../premiumGuard";
import type {
  PartialTranscript,
  StreamingTranscriptionSession,
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSegment,
} from "../types";
import { BaseProvider } from "./BaseProvider";
import { resolveGeminiApiKey } from "./geminiAuth";
import { postGeminiTranscription } from "./GeminiTranscribeProvider";

const PARTIAL_INTERVAL_MS = 2_500;
const MIN_PARTIAL_BYTES = 16_000;

class GeminiPseudoStreamingSession implements StreamingTranscriptionSession {
  readonly id: string;
  readonly providerId: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.GEMINI_LIVE;

  private readonly chunks: ArrayBuffer[] = [];
  private readonly mimeType: string;
  private readonly language?: string;
  private readonly signal?: AbortSignal;
  private partialTimer: ReturnType<typeof setTimeout> | undefined;
  private partialInFlight = false;
  private cancelled = false;
  private lastPartialText = "";
  private partialCallback: ((result: PartialTranscript) => void) | undefined;
  private finalCallback: ((result: TranscriptionSegment) => void) | undefined;
  private errorCallback: ((error: TranscriptionError) => void) | undefined;

  constructor(
    mimeType: string,
    language?: string,
    signal?: AbortSignal,
  ) {
    this.id = generateId();
    this.mimeType = mimeType;
    this.language = language;
    this.signal = signal;
  }

  onPartial(callback: (result: PartialTranscript) => void): void {
    this.partialCallback = callback;
  }

  onFinal(callback: (result: TranscriptionSegment) => void): void {
    this.finalCallback = callback;
  }

  onError(callback: (error: TranscriptionError) => void): void {
    this.errorCallback = callback;
  }

  async pushAudio(chunk: ArrayBuffer): Promise<void> {
    if (this.cancelled) return;
    this.assertNotAborted();
    this.chunks.push(chunk);
    this.schedulePartial();
  }

  async close(): Promise<TranscriptionResult> {
    if (this.cancelled) {
      throw new TranscriptionError("Streaming session cancelled.", "CANCELLED", {
        providerId: this.providerId,
      });
    }

    this.clearPartialTimer();
    const audio = this.toBlob();
    if (!audio || audio.size === 0) {
      throw new TranscriptionError(
        "No audio was captured for Gemini Live transcription.",
        "INVALID_INPUT",
        { providerId: this.providerId },
      );
    }

    const settings = useSettingsStore.getState().settings;
    await checkPremiumTranscriptionAllowed(settings, 0);

    try {
      const result = await postGeminiTranscription(
        {
          audio,
          language: this.language,
          signal: this.signal,
        },
        this.providerId,
        GEMINI_LIVE_MODEL,
      );

      const finalSegment = result.segments.at(-1) ?? {
        startMs: 0,
        endMs: result.durationMs ?? 0,
        text: result.text,
      };
      this.finalCallback?.(finalSegment);
      return result;
    } catch (error) {
      const normalized = normalizeError(error, this.providerId);
      this.errorCallback?.(normalized);
      throw normalized;
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.clearPartialTimer();
    this.chunks.length = 0;
  }

  private schedulePartial(): void {
    if (this.partialTimer || this.cancelled) return;
    this.partialTimer = setTimeout(() => {
      this.partialTimer = undefined;
      void this.emitPartial();
    }, PARTIAL_INTERVAL_MS);
  }

  private clearPartialTimer(): void {
    if (this.partialTimer) {
      clearTimeout(this.partialTimer);
      this.partialTimer = undefined;
    }
  }

  private toBlob(): Blob | undefined {
    if (this.chunks.length === 0) return undefined;
    return new Blob(this.chunks, { type: this.mimeType });
  }

  private totalBytes(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  }

  private async emitPartial(): Promise<void> {
    if (this.cancelled || this.partialInFlight) return;
    if (this.totalBytes() < MIN_PARTIAL_BYTES) {
      this.schedulePartial();
      return;
    }

    const audio = this.toBlob();
    if (!audio) return;

    this.partialInFlight = true;
    try {
      this.assertNotAborted();
      const result = await postGeminiTranscription(
        {
          audio,
          language: this.language,
          signal: this.signal,
        },
        this.providerId,
        GEMINI_LIVE_MODEL,
        resolveGeminiApiKey,
      );

      const text = result.text.trim();
      if (text && text !== this.lastPartialText) {
        this.lastPartialText = text;
        this.partialCallback?.({
          text,
          isFinal: false,
          endMs: result.durationMs,
        });
      }
    } catch (error) {
      const normalized = normalizeError(error, this.providerId);
      if (normalized.code !== "CANCELLED") {
        this.errorCallback?.(normalized);
      }
    } finally {
      this.partialInFlight = false;
      if (!this.cancelled) {
        this.schedulePartial();
      }
    }
  }

  private assertNotAborted(): void {
    if (this.signal?.aborted) {
      throw new TranscriptionError("Transcription cancelled.", "CANCELLED", {
        providerId: this.providerId,
      });
    }
  }
}

export class GeminiLiveProvider extends BaseProvider {
  readonly id: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.GEMINI_LIVE;
  readonly name = "Gemini Live";
  readonly model = GEMINI_LIVE_MODEL;

  capabilities(): TranscriptionCapabilities {
    return {
      fileTranscription: true,
      streaming: true,
      pseudoStreaming: true,
      segmentTimestamps: true,
      wordTimestamps: true,
      diarization: true,
      languageDetection: true,
      customVocabulary: false,
      offline: false,
      supportedLanguages: "auto",
    };
  }

  isConfigured(): boolean {
    return Boolean(resolveGeminiApiKey());
  }

  async healthCheck() {
    const configured = this.isConfigured();
    return {
      healthy: configured,
      message: configured ? undefined : "Gemini API key not configured",
      checkedAt: Date.now(),
    };
  }

  async transcribe(
    input: TranscriptionInput,
    options: TranscriptionOptions = {},
  ): Promise<TranscriptionResult> {
    this.assertNotAborted(options.signal);

    const audio = input.file;
    if (!audio) {
      throw new TranscriptionError(
        "Gemini Live transcription requires an audio file or blob.",
        "INVALID_INPUT",
        { providerId: this.id },
      );
    }

    const settings = useSettingsStore.getState().settings;
    await checkPremiumTranscriptionAllowed(settings, input.durationSeconds ?? 0);

    const language =
      options.language && options.language !== "auto" ? options.language : undefined;

    return postGeminiTranscription(
      {
        audio,
        language,
        signal: options.signal,
        onProgress: options.onProgress
          ? (progress) =>
              options.onProgress?.({
                percent: Math.round(progress * 100),
                message: "Transcribing with Gemini Live…",
              })
          : undefined,
      },
      this.id,
      this.model,
    );
  }

  async startStreaming(
    input: TranscriptionInput,
    options: TranscriptionOptions = {},
  ): Promise<StreamingTranscriptionSession> {
    this.assertNotAborted(options.signal);

    const settings = useSettingsStore.getState().settings;
    await checkPremiumTranscriptionAllowed(settings, input.durationSeconds ?? 0);

    if (!this.isConfigured()) {
      throw new TranscriptionError(
        "Gemini needs an API key. Add one in LLM provider settings.",
        "AUTH_FAILED",
        { providerId: this.id },
      );
    }

    const mimeType = input.file?.type || "audio/webm";
    const language =
      options.language && options.language !== "auto" ? options.language : undefined;

    return new GeminiPseudoStreamingSession(mimeType, language, options.signal);
  }
}
