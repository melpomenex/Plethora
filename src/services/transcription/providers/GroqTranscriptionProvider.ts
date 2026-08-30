import {
  convertGroqToInternalFormat,
  isGroqConfigured,
  transcribeWithGroq,
} from "../../../api/groqTranscription";
import { TRANSCRIPTION_PROVIDER_IDS } from "../config";
import { normalizeError, TranscriptionError } from "../errors";
import type {
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
} from "../types";
import { BaseProvider } from "./BaseProvider";

export class GroqTranscriptionProvider extends BaseProvider {
  readonly id: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.LEGACY_GROQ;
  readonly name = "Groq Whisper";

  capabilities(): TranscriptionCapabilities {
    return {
      fileTranscription: true,
      streaming: false,
      pseudoStreaming: false,
      segmentTimestamps: true,
      wordTimestamps: true,
      diarization: false,
      languageDetection: true,
      customVocabulary: true,
      offline: false,
      supportedLanguages: "auto",
    };
  }

  async healthCheck() {
    return {
      healthy: isGroqConfigured(),
      message: isGroqConfigured() ? undefined : "Groq API key not configured",
      checkedAt: Date.now(),
    };
  }

  async transcribe(
    input: TranscriptionInput,
    options: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    this.assertNotAborted(options.signal);

    if (!isGroqConfigured()) {
      throw new TranscriptionError(
        "Groq API key not configured. Add your key in Audio Transcription settings.",
        "AUTH_FAILED",
        { providerId: this.id },
      );
    }

    try {
      const language = options.language && options.language !== "auto"
        ? options.language
        : undefined;

      const response = await transcribeWithGroq({
        file: input.file,
        filePath: input.filePath,
        url: input.url,
        language,
        prompt: options.prompt,
        responseFormat: "verbose_json",
        timestampGranularities: ["segment"],
        temperature: 0,
        onProgress: options.onProgress
          ? (percent) => options.onProgress?.({ percent, message: "Transcribing with Groq…" })
          : undefined,
      });

      const converted = convertGroqToInternalFormat(response);

      return {
        text: converted.text,
        language: response.language,
        durationSeconds: response.duration,
        providerId: this.id,
        model: undefined,
        segments: converted.segments.map((segment) => ({
          startMs: segment.start_ms,
          endMs: segment.end_ms,
          text: segment.text,
          confidence: segment.confidence,
        })),
        metadata: { source: "groq" },
      };
    } catch (error) {
      throw normalizeError(error, this.id);
    }
  }
}
