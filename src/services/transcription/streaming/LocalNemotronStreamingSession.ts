import { TranscriptionError } from "../errors";
import type {
  PartialTranscript,
  StreamingTranscriptionSession,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSegment,
} from "../types";
import type { LocalNemotronProvider } from "../providers/LocalNemotronProvider";

/**
 * Buffers microphone PCM and runs a single batch local Nemotron transcribe on close.
 * Native streaming lands when the Nemotron sidecar supports partial decode.
 */
export class LocalNemotronStreamingSession implements StreamingTranscriptionSession {
  readonly id: string;
  readonly providerId: TranscriptionProviderId;

  private readonly provider: LocalNemotronProvider;
  private readonly filePath?: string;
  private readonly language?: string;
  private readonly chunks: ArrayBuffer[] = [];
  private partialCallbacks: Array<(result: PartialTranscript) => void> = [];
  private finalCallbacks: Array<(result: TranscriptionSegment) => void> = [];
  private errorCallbacks: Array<(error: TranscriptionError) => void> = [];
  private closed = false;
  private cancelled = false;

  constructor(provider: LocalNemotronProvider, filePath?: string, language?: string) {
    this.id = crypto.randomUUID();
    this.provider = provider;
    this.providerId = provider.id;
    this.filePath = filePath;
    this.language = language;
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
    if (this.closed || this.cancelled) return;
    this.chunks.push(chunk);
    const bytes = this.chunks.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    this.partialCallbacks.forEach((cb) =>
      cb({ text: "", isFinal: false, startMs: 0, endMs: Math.round(bytes / 32) }),
    );
  }

  async close(): Promise<TranscriptionResult> {
    if (this.cancelled) {
      throw new TranscriptionError("Streaming session was cancelled.", "CANCELLED", {
        providerId: this.providerId,
      });
    }
    this.closed = true;

    if (!this.filePath) {
      throw new TranscriptionError(
        "Local Nemotron streaming requires a source file path until the native realtime runtime ships.",
        "PROVIDER_UNAVAILABLE",
        { providerId: this.providerId },
      );
    }

    const result = await this.provider.transcribe(
      { filePath: this.filePath },
      { language: this.language },
    );
    for (const segment of result.segments) {
      this.finalCallbacks.forEach((cb) => cb(segment));
    }
    return result;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.closed = true;
  }
}
