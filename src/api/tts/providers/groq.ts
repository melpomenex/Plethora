import { getProviderSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { mapHttpError, readProviderMessage, TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { binaryResult, fetchBinary } from "./shared";

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

export const groqAdapter: TTSProviderAdapter = {
  id: "groq",
  label: "Groq",
  kind: "cloud",
  auth: { mode: "borrowed", borrowFrom: { store: "audioTranscription", provider: "groq" } },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    audioFormats: ["mp3", "wav"],
    maxInputChars: 5000,
  },
  async listModels(ctx): Promise<TTSModelInfo[]> {
    const config = getProviderSettings(ctx.tts, "groq");
    return ["playai-tts", "playai-tts-arabic"].map((id) => ({ id, name: id, vendor: "Groq", supportedVoices: null, supportedParameters: ["speed"] }));
  },
  async listVoices(_ctx, modelId): Promise<TTSVoiceInfo[]> {
    const voices = ["Fiora", "Arista", "Aster", "Puck", "Aoede", "Kore", "Leda", "Orpheus", "Angus", "Athena", "Helios", "Hera", "Luna", "Orion", "Perseus", "Stella"];
    return voices.map((id) => ({ id: id.toLowerCase(), name: id, provider: "groq", modelId, vendor: "Groq" }));
  },
  async synthesize(ctx, request) {
    const resolved = resolveProviderKey(groqAdapter, ctx.settings);
    if (!resolved.key) throw new TTSServiceError("Groq API key is required. Add one in Audio Transcription or TTS settings.", "validation");
    const config = getProviderSettings(ctx.tts, "groq");
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    const format = request.responseFormat === "wav" ? "wav" : "mp3";
    const result = await fetchBinary("groq", `${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.key}` },
      body: JSON.stringify({ model: request.model, voice: (request.voice || "fiora").toLowerCase(), input: request.text, response_format: format, speed: request.speed ?? 1 }),
    }, format);
    return binaryResult("groq", request.model, format, result.data, result.mimeType);
  },
};
