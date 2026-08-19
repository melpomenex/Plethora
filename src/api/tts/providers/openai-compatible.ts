import { getProviderSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { binaryResult, fetchBinary, fetchJson } from "./shared";
import { normalizeAzureWordBoundaries } from "../timing";

export function normalizeOpenAICompatibleBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export const openAICompatibleAdapter: TTSProviderAdapter = {
  id: "openai-compatible",
  label: "OpenAI-compatible",
  kind: "cloud",
  auth: { mode: "apiKey" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: true,
    supportsWordTimings: false,
    audioFormats: ["mp3", "wav", "pcm"],
    maxInputChars: 5000,
  },
  canEnumerateModels: false,
  async listModels(): Promise<TTSModelInfo[]> { return []; },
  async listVoices(ctx, modelId): Promise<TTSVoiceInfo[]> {
    const config = getProviderSettings(ctx.tts, "openai-compatible");
    return config.voiceId ? [{ id: config.voiceId, name: config.voiceId, provider: "openai-compatible", modelId, vendor: "Configured endpoint" }] : [];
  },
  async synthesize(ctx, request) {
    const key = resolveProviderKey(openAICompatibleAdapter, ctx.settings).key;
    const config = getProviderSettings(ctx.tts, "openai-compatible");
    const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
    if (!baseUrl) throw new TTSServiceError("An OpenAI-compatible base URL is required.", "validation");
    if (!key) throw new TTSServiceError("An OpenAI-compatible API key is required.", "validation");
    if (!request.voice) throw new TTSServiceError("An OpenAI-compatible voice is required.", "validation");
    const format = request.responseFormat || "mp3";
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: request.model, input: request.text, voice: request.voice, response_format: format, speed: request.speed ?? 1 }),
    };

    // Azure-style relays may answer with JSON word-boundary metadata; the
    // standard OpenAI speech API is binary-only. Probe for JSON metadata only
    // when timings are requested; any failure falls back to the binary path.
    if (request.includeTimings) {
      try {
        const payload = await fetchJson("openai-compatible", `${baseUrl}/audio/speech`, init);
        const wordTimings = normalizeAzureWordBoundaries(request.text, payload);
        const audioUrl = (payload as { audio_url?: string; audio?: { url?: string } }).audio_url ?? (payload as { audio?: { url?: string } }).audio?.url;
        if (wordTimings && typeof audioUrl === "string") {
          return { audioUrl, rawOutput: payload as Record<string, unknown>, wordTimings };
        }
      } catch {
        // Binary-only endpoint — continue below.
      }
    }

    const result = await fetchBinary("openai-compatible", `${baseUrl}/audio/speech`, init, format);
    return binaryResult("openai-compatible", request.model, format, result.data, result.mimeType);
  },
};
