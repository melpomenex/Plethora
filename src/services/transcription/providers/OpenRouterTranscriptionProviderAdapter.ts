import { useSettingsStore } from "../../../stores/settingsStore";
import { normalizeError, TranscriptionError } from "../errors";
import type {
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
} from "../types";
import { BaseProvider } from "./BaseProvider";
import type { OpenRouterAsrProvider } from "./OpenRouterAsrProvider";

/**
 * Adapts OpenRouterAsrProvider (HTTP boundary) to TranscriptionProvider (service boundary).
 */
export class OpenRouterTranscriptionProviderAdapter extends BaseProvider {
  readonly id: TranscriptionProviderId;
  readonly name: string;

  constructor(private readonly delegate: OpenRouterAsrProvider) {
    super();
    this.id = delegate.id;
    this.name = delegate.label;
  }

  capabilities(): TranscriptionCapabilities {
    return {
      fileTranscription: true,
      streaming: false,
      pseudoStreaming: true,
      segmentTimestamps: true,
      wordTimestamps: true,
      diarization: false,
      languageDetection: true,
      customVocabulary: false,
      offline: false,
      supportedLanguages: "auto",
    };
  }

  isConfigured(settings = useSettingsStore.getState().settings): boolean {
    return this.delegate.isConfigured(settings);
  }

  async healthCheck() {
    const settings = useSettingsStore.getState().settings;
    const configured = this.isConfigured(settings);
    return {
      healthy: configured,
      message: configured ? undefined : "OpenRouter API key not configured",
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
        "OpenRouter transcription requires an audio file or blob.",
        "INVALID_INPUT",
        { providerId: this.id },
      );
    }

    const settings = useSettingsStore.getState().settings;
    const language =
      options.language && options.language !== "auto" ? options.language : undefined;

    try {
      return await this.delegate.transcribe(
        {
          audio,
          language,
          signal: options.signal,
          onProgress: options.onProgress
            ? (progress) =>
                options.onProgress?.({
                  percent: Math.round(progress * 100),
                  message: "Transcribing with OpenRouter…",
                })
            : undefined,
        },
        settings,
      );
    } catch (error) {
      throw normalizeError(error, this.id);
    }
  }
}

export function adaptOpenRouterProvider(
  delegate: OpenRouterAsrProvider,
): OpenRouterTranscriptionProviderAdapter {
  return new OpenRouterTranscriptionProviderAdapter(delegate);
}
