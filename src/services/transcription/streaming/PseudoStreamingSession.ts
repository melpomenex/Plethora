import { normalizeError, TranscriptionError } from "../errors";
import { checkRealtimeSessionHealth } from "../DeviceCapabilityService";
import { mergeTranscriptChunks } from "../reconciliation";
import type {
  PartialTranscript,
  StreamingTranscriptionSession,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSegment,
} from "../types";
import { VoiceActivityDetector, type VoiceActivityDetectorConfig } from "../audio/VoiceActivityDetector";
import { pcmFloat32ToWavBlob } from "../audio/pcmToWav";

const REALTIME_LAG_WARNING_FACTOR = 1.5;

export interface PseudoStreamingSessionOptions {
  provider: TranscriptionProvider;
  language?: string;
  sampleRate?: number;
  vad?: VoiceActivityDetectorConfig;
  signal?: AbortSignal;
}

/**
 * Near-live cloud transcription by VAD-chunking PCM, calling batch STT per utterance,
 * and reconciling overlapping text via suffix/prefix merge.
 */
export class PseudoStreamingSession implements StreamingTranscriptionSession {
  readonly id: string;
  readonly providerId: TranscriptionProviderId;

  private readonly provider: TranscriptionProvider;
  private readonly language?: string;
  private readonly sampleRate: number;
  private readonly signal?: AbortSignal;
  private readonly vad: VoiceActivityDetector;

  private partialCallbacks: Array<(result: PartialTranscript) => void> = [];
  private finalCallbacks: Array<(result: TranscriptionSegment) => void> = [];
  private errorCallbacks: Array<(error: TranscriptionError) => void> = [];

  private chunkTexts: string[] = [];
  private segments: TranscriptionSegment[] = [];
  private totalAudioMs = 0;
  private totalProcessingMs = 0;
  private lagWarningEmitted = false;
  private mobileHealthWarningEmitted = false;
  private cancelled = false;
  private closed = false;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(options: PseudoStreamingSessionOptions) {
    this.id = crypto.randomUUID();
    this.provider = options.provider;
    this.providerId = options.provider.id as TranscriptionProviderId;
    this.language = options.language;
    this.sampleRate = options.sampleRate ?? 16000;
    this.signal = options.signal;
    this.vad = new VoiceActivityDetector({
      sampleRate: this.sampleRate,
      ...options.vad,
    });
  }

  onPartial(callback: (result: PartialTranscript) => void): void {
    this.partialCallbacks.push(callback);
  }

  onFinal(callback: (result: TranscriptionSegment) => void): void {
    this.finalCallbacks.push(callback);
  }

  onError(callback: (error: TranscriptionError) => void): void {
    this.errorCallbacks.push(callback);
  }

  async pushAudio(chunk: ArrayBuffer): Promise<void> {
    if (this.cancelled || this.closed) return;
    this.assertNotAborted();
    await this.maybeEmitMobileHealthWarning();

    const pcm = new Float32Array(chunk);
    const vadSegments = this.vad.push(pcm);

    for (const segment of vadSegments) {
      this.processingChain = this.processingChain.then(() => this.processSegment(segment));
    }

    await this.processingChain;
  }

  async close(): Promise<TranscriptionResult> {
    if (this.closed) {
      return this.buildResult();
    }

    this.closed = true;
    const trailing = this.vad.flush();
    if (trailing) {
      this.processingChain = this.processingChain.then(() => this.processSegment(trailing));
    }
    await this.processingChain;

    return this.buildResult();
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.closed = true;
  }

  /** Realtime factor: processing ms / audio ms (>1 means slower than realtime). */
  getRealtimeFactor(): number {
    if (this.totalAudioMs <= 0) return 0;
    return this.totalProcessingMs / this.totalAudioMs;
  }

  private async processSegment(segment: {
    samples: Float32Array;
    durationMs: number;
    startMs: number;
  }): Promise<void> {
    if (this.cancelled) return;
    this.assertNotAborted();

    this.totalAudioMs += segment.durationMs;
    const startedAt = performance.now();

    try {
      const audio = pcmFloat32ToWavBlob(segment.samples, this.sampleRate);
      const result = await this.provider.transcribe(
        { file: audio },
        { language: this.language, signal: this.signal },
      );

      const text = result.text.trim();
      if (!text) return;

      this.chunkTexts.push(text);
      const mergedText = mergeTranscriptChunks(this.chunkTexts);

      for (const callback of this.partialCallbacks) {
        callback({ text: mergedText, isFinal: false });
      }

      const finalSegment: TranscriptionSegment = {
        startMs: segment.startMs,
        endMs: segment.startMs + segment.durationMs,
        text,
      };
      this.segments.push(finalSegment);

      for (const callback of this.finalCallbacks) {
        callback(finalSegment);
      }

      this.totalProcessingMs += performance.now() - startedAt;
      this.maybeEmitLagWarning();
    } catch (error) {
      const normalized = normalizeError(error, this.providerId);
      for (const callback of this.errorCallbacks) {
        callback(normalized);
      }
    }
  }

  private maybeEmitLagWarning(): void {
    if (this.lagWarningEmitted || this.totalAudioMs <= 0) return;

    const factor = this.getRealtimeFactor();
    if (factor <= REALTIME_LAG_WARNING_FACTOR) return;

    this.lagWarningEmitted = true;
    const warning = new TranscriptionError(
      `Transcription is falling behind realtime (${factor.toFixed(2)}× audio duration).`,
      "TIMEOUT",
      { recoverable: true, providerId: this.providerId },
    );
    for (const callback of this.errorCallbacks) {
      callback(warning);
    }
  }

  private async maybeEmitMobileHealthWarning(): Promise<void> {
    if (this.mobileHealthWarningEmitted) return;
    const health = await checkRealtimeSessionHealth();
    if (!health.shouldWarn || !health.reason) return;

    this.mobileHealthWarningEmitted = true;
    const warning = new TranscriptionError(health.reason, "TIMEOUT", {
      recoverable: true,
      providerId: this.providerId,
    });
    for (const callback of this.errorCallbacks) {
      callback(warning);
    }
  }

  private buildResult(): TranscriptionResult {
    return {
      text: mergeTranscriptChunks(this.chunkTexts),
      segments: this.segments,
      durationMs: this.totalAudioMs,
      durationSeconds: this.totalAudioMs / 1000,
      providerId: this.providerId,
      metadata: {
        pseudoStreaming: true,
        realtimeFactor: this.getRealtimeFactor(),
        chunkCount: this.chunkTexts.length,
      },
    };
  }

  private assertNotAborted(): void {
    if (this.signal?.aborted) {
      throw new DOMException("Transcription was cancelled.", "AbortError");
    }
  }
}

export function createPseudoStreamingSession(
  provider: TranscriptionProvider,
  options: Omit<TranscriptionOptions, "onProgress"> & { vad?: VoiceActivityDetectorConfig } = {},
): PseudoStreamingSession {
  return new PseudoStreamingSession({
    provider,
    language: options.language,
    signal: options.signal,
    vad: options.vad,
  });
}
