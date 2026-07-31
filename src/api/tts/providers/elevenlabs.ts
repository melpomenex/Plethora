import { getProviderSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { binaryResult, fetchBinary, fetchJson } from "./shared";

const BASE_URL = "https://api.elevenlabs.io";

export const elevenlabsAdapter: TTSProviderAdapter = {
  id: "elevenlabs",
  label: "ElevenLabs",
  kind: "cloud",
  auth: { mode: "apiKey", docsUrl: "https://elevenlabs.io/app/settings/api-keys" },
  capabilities: {
    supportsSpeed: false,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: true,
    audioFormats: ["mp3", "wav"],
    maxInputChars: 5000,
  },
  canEnumerateModels: true,
  async listModels(ctx) {
    const key = resolveProviderKey(elevenlabsAdapter, ctx.settings).key;
    if (!key) return [];
    const payload = await fetchJson("elevenlabs", `${BASE_URL}/v1/models`, { headers: { "xi-api-key": key } }) as unknown;
    return Array.isArray(payload) ? payload.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).model_id !== "string") return [];
      const row = item as Record<string, unknown>;
      return [{ id: row.model_id as string, name: typeof row.name === "string" ? row.name : row.model_id as string, vendor: "ElevenLabs", supportedVoices: null, supportedParameters: [] } satisfies TTSModelInfo];
    }) : [];
  },
  async listVoices(ctx, modelId) {
    const key = resolveProviderKey(elevenlabsAdapter, ctx.settings).key;
    if (!key) return [];
    const payload = await fetchJson("elevenlabs", `${BASE_URL}/v1/voices`, { headers: { "xi-api-key": key } }) as { voices?: unknown };
    return Array.isArray(payload.voices) ? payload.voices.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.voice_id !== "string") return [];
      return [{ id: row.voice_id, name: typeof row.name === "string" ? row.name : row.voice_id, provider: "elevenlabs", modelId, vendor: "ElevenLabs", metadata: row } satisfies TTSVoiceInfo];
    }) : [];
  },
  async synthesize(ctx, request) {
    const key = resolveProviderKey(elevenlabsAdapter, ctx.settings).key;
    if (!key) throw new TTSServiceError("ElevenLabs API key is required.", "validation");
    if (!request.voice) throw new TTSServiceError("An ElevenLabs voice is required.", "validation");
    const format = request.responseFormat || "mp3";
    const result = await fetchBinary("elevenlabs", `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(request.voice)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": key },
      body: JSON.stringify({ text: request.text, model_id: request.model, output_format: format }),
    }, format);
    return binaryResult("elevenlabs", request.model, format, result.data, result.mimeType);
  },
};
