import { getProviderSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { binaryResult, fetchBinary } from "./shared";

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
    const result = await fetchBinary("openai-compatible", `${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: request.model, input: request.text, voice: request.voice, response_format: format, speed: request.speed ?? 1 }),
    }, format);
    return binaryResult("openai-compatible", request.model, format, result.data, result.mimeType);
  },
};
