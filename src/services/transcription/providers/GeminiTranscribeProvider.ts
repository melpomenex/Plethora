import { ensureCloudAiDisclosure } from "../../../lib/privacy/cloudAiDisclosure";
import { useSettingsStore } from "../../../stores/settingsStore";
import {
  GEMINI_TRANSCRIBE_MODEL,
  GEMINI_TRANSCRIPTION_URL,
  TRANSCRIPTION_PROVIDER_IDS,
} from "../config";
import {
  mapHttpStatusToTranscriptionError,
  readProviderMessage,
  TranscriptionError,
} from "../errors";
import {
  checkPremiumTranscriptionAllowed,
  recordPremiumTranscriptionUsage,
} from "../premiumGuard";
import type {
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
} from "../types";
import { audioFilename } from "./audioHttpUtils";
import { BaseProvider } from "./BaseProvider";
import { resolveGeminiApiKey } from "./geminiAuth";
import {
  normalizeOpenRouterResponse,
  type OpenRouterTranscribeRequest,
} from "./OpenRouterAsrProvider";

const TRANSCRIPTION_TIMEOUT_MS = 120_000;

interface GeminiSttResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
    speaker?: number | string;
  }>;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    speaker?: number | string;
  }>;
}

export async function postGeminiTranscription(
  request: OpenRouterTranscribeRequest,
  providerId: TranscriptionProviderId,
  model: string,
  resolveKey: () => string = resolveGeminiApiKey,
): Promise<TranscriptionResult> {
  const settings = useSettingsStore.getState().settings;
  const apiKey = resolveKey();
  if (!apiKey) {
    throw new TranscriptionError(
      "Gemini needs an API key. Add one in LLM provider settings.",
      "AUTH_FAILED",
      { providerId },
    );
  }

  if (
    !(await ensureCloudAiDisclosure({
      featureClass: "transcription",
      provider: "gemini",
    }))
  ) {
    throw new TranscriptionError(
      "Cloud transcription disclosure declined — audio was not sent.",
      "DISCLOSURE_DECLINED",
      { providerId },
    );
  }

  request.onProgress?.(0.1);

  const formData = new FormData();
  formData.append("file", request.audio, audioFilename(request.audio));
  formData.append("model", model);
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");
  formData.append("timestamp_granularities[]", "word");
  formData.append("temperature", "0");

  if (request.language) {
    formData.append("language", request.language);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
  const abortFromSignal = () => controller.abort();
  request.signal?.addEventListener("abort", abortFromSignal);

  let response: Response;
  try {
    response = await fetch(GEMINI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (request.signal?.aborted) {
      throw new TranscriptionError("Transcription cancelled.", "CANCELLED", { providerId });
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new TranscriptionError(
        "Gemini transcription timed out. Try again with a shorter clip.",
        "TIMEOUT",
        { recoverable: true, providerId },
      );
    }
    throw new TranscriptionError(
      "Network error while contacting Gemini.",
      "NETWORK_ERROR",
      { recoverable: true, providerId, cause: error },
    );
  } finally {
    clearTimeout(timeoutId);
    request.signal?.removeEventListener("abort", abortFromSignal);
  }

  request.onProgress?.(0.9);

  if (!response.ok) {
    const message = await readProviderMessage(response);
    throw mapHttpStatusToTranscriptionError(response.status, message);
  }

  const payload = await response.json() as GeminiSttResponse;
  request.onProgress?.(1);

  const result = normalizeOpenRouterResponse(payload, providerId, model);
  const durationSeconds = result.durationSeconds ?? 0;
  await recordPremiumTranscriptionUsage(durationSeconds, { providerId, model });
  return result;
}

export class GeminiTranscribeProvider extends BaseProvider {
  readonly id: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE;
  readonly name = "Gemini Transcribe";
  readonly model = GEMINI_TRANSCRIBE_MODEL;

  capabilities(): TranscriptionCapabilities {
    return {
      fileTranscription: true,
      streaming: false,
      pseudoStreaming: false,
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
        "Gemini transcription requires an audio file or blob.",
        "INVALID_INPUT",
        { providerId: this.id },
      );
    }

    const settings = useSettingsStore.getState().settings;
    const durationSeconds = input.durationSeconds ?? 0;
    await checkPremiumTranscriptionAllowed(settings, durationSeconds);

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
                message: "Transcribing with Gemini…",
              })
          : undefined,
      },
      this.id,
      this.model,
    );
  }
}
