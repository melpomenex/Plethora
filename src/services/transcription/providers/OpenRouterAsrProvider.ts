import { resolveProviderKey } from "../../../api/tts/auth";
import type { TTSProviderAdapter } from "../../../api/tts/types";
import { ensureCloudAiDisclosure } from "../../../lib/privacy/cloudAiDisclosure";
import type { Settings } from "../../../stores/settingsStore";
import { OPENROUTER_ASR_MODELS, OPENROUTER_TRANSCRIPTION_URL } from "../config";
import {
  mapHttpStatusToTranscriptionError,
  readProviderMessage,
  TranscriptionError,
} from "../errors";
import type {
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionWord,
} from "../types";

export const OPENROUTER_TRANSCRIPTIONS_URL = OPENROUTER_TRANSCRIPTION_URL;

const OPENROUTER_AUTH = {
  mode: "borrowed" as const,
  borrowFrom: { store: "llmProviders" as const, provider: "openrouter" },
  docsUrl: "https://openrouter.ai/settings/keys",
};

const OPENROUTER_ADAPTER: Pick<TTSProviderAdapter, "id" | "auth"> = {
  id: "openrouter",
  auth: OPENROUTER_AUTH,
};

const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/aac": "aac",
};

const TRANSCRIPTION_TIMEOUT_MS = 120_000;

export interface OpenRouterAsrConfig {
  id: TranscriptionProviderId;
  label: string;
  model: string;
}

export interface OpenRouterTranscribeRequest {
  audio: File | Blob;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

interface OpenRouterSttSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  speaker?: number | string;
}

interface OpenRouterSttWord {
  word: string;
  start: number;
  end: number;
  speaker?: number | string;
}

interface OpenRouterSttResponse {
  text: string;
  task?: string;
  language?: string;
  duration?: number;
  segments?: OpenRouterSttSegment[];
  words?: OpenRouterSttWord[];
  usage?: {
    cost?: number;
    seconds?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenRouterAsrProvider {
  id: TranscriptionProviderId;
  label: string;
  model: string;
  isConfigured(settings: Settings): boolean;
  transcribe(request: OpenRouterTranscribeRequest, settings: Settings): Promise<TranscriptionResult>;
}

type KeyResolver = (settings: Settings) => string;

function resolveOpenRouterKey(settings: Settings): string {
  return resolveProviderKey(OPENROUTER_ADAPTER, settings).key;
}

function audioFilename(audio: File | Blob): string {
  if (audio instanceof File && audio.name.trim()) return audio.name;
  const extension = MIME_TO_EXTENSION[audio.type] || "wav";
  return `audio.${extension}`;
}

function secondsToMs(value: number): number {
  return Math.round(value * 1000);
}

function speakerId(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return String(value);
}

function normalizeSegments(response: OpenRouterSttResponse): TranscriptionSegment[] {
  if (response.segments?.length) {
    return response.segments.map((segment) => ({
      startMs: secondsToMs(segment.start),
      endMs: secondsToMs(segment.end),
      text: segment.text,
      confidence: segment.avg_logprob !== undefined ? Math.exp(segment.avg_logprob) : undefined,
      speakerId: speakerId(segment.speaker),
    }));
  }

  if (!response.text.trim()) return [];

  return [{
    startMs: 0,
    endMs: response.duration ? secondsToMs(response.duration) : 0,
    text: response.text.trim(),
  }];
}

function normalizeWords(words: OpenRouterSttWord[] | undefined): TranscriptionWord[] | undefined {
  if (!words?.length) return undefined;
  return words.map((word) => ({
    word: word.word,
    startMs: secondsToMs(word.start),
    endMs: secondsToMs(word.end),
    speakerId: speakerId(word.speaker),
  }));
}

export function normalizeOpenRouterResponse(
  response: OpenRouterSttResponse,
  providerId: TranscriptionProviderId,
  model: string,
): TranscriptionResult {
  const segments = normalizeSegments(response);
  const words = normalizeWords(response.words);

  if (words?.length && segments.length === 1 && !segments[0].words) {
    segments[0] = { ...segments[0], words };
  }

  return {
    text: response.text.trim(),
    language: response.language,
    segments,
    durationSeconds: response.duration,
    durationMs: response.duration ? secondsToMs(response.duration) : undefined,
    providerId,
    model,
    metadata: response.usage ? { usage: response.usage } : undefined,
  };
}

async function postTranscription(
  request: OpenRouterTranscribeRequest,
  settings: Settings,
  config: OpenRouterAsrConfig,
  resolveKey: KeyResolver = resolveOpenRouterKey,
): Promise<TranscriptionResult> {
  const apiKey = resolveKey(settings);
  if (!apiKey) {
    throw new TranscriptionError(
      "OpenRouter needs an API key. Add one in LLM provider settings.",
      "AUTH_FAILED",
      { providerId: config.id },
    );
  }

  if (
    !(await ensureCloudAiDisclosure({
      featureClass: "transcription",
      provider: "openrouter",
    }))
  ) {
    throw new TranscriptionError(
      "Cloud transcription disclosure declined — audio was not sent.",
      "DISCLOSURE_DECLINED",
      { providerId: config.id },
    );
  }

  request.onProgress?.(0.1);

  const formData = new FormData();
  formData.append("file", request.audio, audioFilename(request.audio));
  formData.append("model", config.model);
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
    response = await fetch(OPENROUTER_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (request.signal?.aborted) {
      throw new TranscriptionError("Transcription cancelled.", "CANCELLED", { providerId: config.id });
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new TranscriptionError(
        "OpenRouter transcription timed out. Try again with a shorter clip.",
        "TIMEOUT",
        { recoverable: true, providerId: config.id },
      );
    }
    throw new TranscriptionError(
      "Network error while contacting OpenRouter.",
      "NETWORK_ERROR",
      { recoverable: true, providerId: config.id, cause: error },
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

  const payload = await response.json() as OpenRouterSttResponse;
  request.onProgress?.(1);
  return normalizeOpenRouterResponse(payload, config.id, config.model);
}

export function createOpenRouterAsrProvider(
  config: OpenRouterAsrConfig,
  resolveKey: KeyResolver = resolveOpenRouterKey,
): OpenRouterAsrProvider {
  return {
    id: config.id,
    label: config.label,
    model: config.model,
    isConfigured(settings) {
      return Boolean(resolveKey(settings));
    },
    transcribe(request, settings) {
      return postTranscription(request, settings, config, resolveKey);
    },
  };
}

/** @deprecated Use createOpenRouterNemotronProvider */
export function createNemotronProvider(apiKey: string) {
  const trimmedKey = apiKey.trim();
  const provider = createOpenRouterAsrProvider({
    id: "openrouter:nemotron-3.5",
    label: "OpenRouter Nemotron 3.5 ASR",
    model: OPENROUTER_ASR_MODELS.NEMOTRON,
  }, () => trimmedKey);
  return {
    transcribe(request: OpenRouterTranscribeRequest) {
      return provider.transcribe(request, {} as Settings);
    },
  };
}
