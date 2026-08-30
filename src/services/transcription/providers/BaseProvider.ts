import type {
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionResult,
} from "../types";

export abstract class BaseProvider implements TranscriptionProvider {
  abstract readonly id: TranscriptionProviderId;
  abstract readonly name: string;

  abstract capabilities(): TranscriptionCapabilities | Promise<TranscriptionCapabilities>;
  abstract transcribe(input: TranscriptionInput, options: TranscriptionOptions): Promise<TranscriptionResult>;

  protected assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("Transcription was cancelled.", "AbortError");
    }
  }
}
