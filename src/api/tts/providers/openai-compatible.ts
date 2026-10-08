import { getProviderSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { binaryResult, fetchBinary, fetchJson } from "./shared";
import { normalizeAzureWordBoundaries } from "../timing";

export function normalizeOpenAICompatibleBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function isLocalhostEndpoint(baseUrl: string): boolean {
  return (
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("localhost") ||
    baseUrl.startsWith("http://0.0.0.0")
  );
}

export async function cloneOpenAIVoice(
  baseUrl: string,
  apiKey: string | undefined,
  name: string,
  audioBase64: string,
  description?: string
): Promise<{ id: string; name: string; latentPath?: string }> {
  const normUrl = normalizeOpenAICompatibleBaseUrl(baseUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const payload = await fetchJson("openai-compatible", `${normUrl}/audio/voices`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name,
      description,
      audio_base64: audioBase64,
    }),
  });
  return payload as { id: string; name: string; latentPath?: string };
}

export const openAICompatibleAdapter: TTSProviderAdapter = {
  id: "openai-compatible",
  label: "OpenAI-compatible",
  kind: "cloud",
  auth: { mode: "apiKey" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: false,
    supportsCloning: true,
    supportsCustomVoiceIds: true,
    supportsWordTimings: false,
    audioFormats: ["mp3", "wav", "pcm"],
    maxInputChars: 5000,
  },
  canEnumerateModels: true,
  async listModels(ctx): Promise<TTSModelInfo[]> {
    const config = getProviderSettings(ctx.tts, "openai-compatible");
    const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
    if (!baseUrl) return [];
    try {
      const key = resolveProviderKey(openAICompatibleAdapter, ctx.settings).key;
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      const payload = (await fetchJson("openai-compatible", `${baseUrl}/models`, { headers })) as {
        data?: Array<{ id: string; name?: string; description?: string }>;
      };
      if (payload && Array.isArray(payload.data)) {
        return payload.data.map((m) => ({
          id: m.id,
          name: m.name || m.id,
          description: m.description,
          vendor: isLocalhostEndpoint(baseUrl) ? "Local Daemon" : "Remote Server",
          supportedVoices: null,
          supportedParameters: ["speed"],
        }));
      }
    } catch {
      // Fallback
    }
    return [];
  },
  async listVoices(ctx, modelId): Promise<TTSVoiceInfo[]> {
    const config = getProviderSettings(ctx.tts, "openai-compatible");
    const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
    if (baseUrl) {
      try {
        const key = resolveProviderKey(openAICompatibleAdapter, ctx.settings).key;
        const headers: Record<string, string> = {};
        if (key) headers.Authorization = `Bearer ${key}`;
        const payload = (await fetchJson("openai-compatible", `${baseUrl}/audio/voices`, { headers })) as {
          voices?: Array<{ id: string; name: string; description?: string }>;
        };
        if (payload && Array.isArray(payload.voices) && payload.voices.length > 0) {
          return payload.voices.map((v) => ({
            id: v.id,
            name: v.name,
            provider: "openai-compatible",
            modelId,
            vendor: isLocalhostEndpoint(baseUrl) ? "Local Daemon" : "Remote Server",
          }));
        }
      } catch {
        // Fallback
      }
    }
    return config.voiceId ? [{ id: config.voiceId, name: config.voiceId, provider: "openai-compatible", modelId, vendor: "Configured endpoint" }] : [];
  },
  async synthesize(ctx, request) {
    const key = resolveProviderKey(openAICompatibleAdapter, ctx.settings).key;
    const config = getProviderSettings(ctx.tts, "openai-compatible");
    const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
    if (!baseUrl) throw new TTSServiceError("An OpenAI-compatible base URL is required.", "validation");
    
    const isLocal = isLocalhostEndpoint(baseUrl);
    if (!key && !isLocal) {
      throw new TTSServiceError("An OpenAI-compatible API key is required.", "validation");
    }

    const voice = request.voice || request.voiceProfile?.voice || config.voiceId || "chatterbox-default";
    const format = request.responseFormat || "mp3";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }

    const init: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: request.model || "chatterbox",
        input: request.text,
        voice,
        response_format: format,
        // Chatterbox Turbo exposes no speed parameter: callers pass
        // `speed: undefined` on that path and it must be omitted, not
        // defaulted, so the server never receives a meaningless value.
        ...(request.speed !== undefined ? { speed: request.speed } : {}),
      }),
    };

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
    return binaryResult("openai-compatible", request.model || "chatterbox", format, result.data, result.mimeType);
  },
};
