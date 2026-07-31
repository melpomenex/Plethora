import { resolveProviderKey } from "../auth";
import { TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { binaryResult, fetchBinary } from "./shared";

const BASE_URL = "https://api.openai.com/v1";

export const openaiAdapter: TTSProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  kind: "cloud",
  auth: { mode: "apiKey", docsUrl: "https://platform.openai.com/api-keys" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: true,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    audioFormats: ["mp3", "opus", "aac", "flac", "wav", "pcm"],
    maxInputChars: 5000,
  },
  canEnumerateModels: true,
  async listModels(): Promise<TTSModelInfo[]> {
    return ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"].map((id) => ({ id, name: id, vendor: "OpenAI", supportedVoices: ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"], supportedParameters: ["speed", "instructions"], contextLength: 4096 }));
  },
  async listVoices(_ctx, modelId): Promise<TTSVoiceInfo[]> {
    return ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"].map((id) => ({ id, name: id, provider: "openai", modelId, vendor: "OpenAI" }));
  },
  async synthesize(ctx, request) {
    const key = resolveProviderKey(openaiAdapter, ctx.settings).key;
    if (!key) throw new TTSServiceError("OpenAI API key is required.", "validation");
    if (!request.voice) throw new TTSServiceError("An OpenAI voice is required.", "validation");
    const format = request.responseFormat || "mp3";
    const body: Record<string, unknown> = { model: request.model, input: request.text, voice: request.voice, response_format: format, speed: request.speed ?? 1 };
    if (request.instructions?.trim()) body.instructions = request.instructions.trim();
    const result = await fetchBinary("openai", `${BASE_URL}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    }, format);
    return binaryResult("openai", request.model, format, result.data, result.mimeType);
  },
};
