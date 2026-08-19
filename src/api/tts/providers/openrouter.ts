import { getProviderSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { mapHttpError, readProviderMessage, TTSServiceError } from "../errors";
import { getCatalog, type CatalogResult } from "../catalog";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { audioMime, fetchBinary } from "./shared";

export const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

function modelVoices(model: TTSModelInfo): string[] {
  return model.supportedVoices ? [...model.supportedVoices] : [];
}

export function modelSupportsParameter(model: TTSModelInfo | undefined, parameter: string): boolean {
  return Boolean(model?.supportedParameters.some((item) => item.toLowerCase() === parameter.toLowerCase()));
}

export function resetVoiceForModel(
  model: TTSModelInfo | undefined,
  currentVoice: string,
): { voice: string; changed: boolean } {
  if (!model || model.supportedVoices === null) return { voice: currentVoice, changed: false };
  const voices = modelVoices(model);
  if (voices.includes(currentVoice)) return { voice: currentVoice, changed: false };
  return { voice: voices[0] || "", changed: currentVoice !== (voices[0] || "") };
}

async function catalogFor(ctx: TTSAdapterContext): Promise<CatalogResult> {
  return getCatalog({ apiKey: resolveProviderKey(openrouterAdapter, ctx.settings).key || undefined });
}

export const openrouterAdapter: TTSProviderAdapter = {
  id: "openrouter",
  label: "OpenRouter",
  kind: "cloud",
  auth: {
    mode: "borrowed",
    borrowFrom: { store: "llmProviders", provider: "openrouter" },
    docsUrl: "https://openrouter.ai/settings/keys",
  },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: true,
    supportsCloning: false,
    supportsCustomVoiceIds: true,
    supportsWordTimings: false,
    audioFormats: ["mp3", "wav", "pcm"],
    maxInputChars: 5000,
  },
  canEnumerateModels: true,
  async listModels(ctx) {
    return (await catalogFor(ctx)).models;
  },
  async listVoices(ctx, modelId) {
    const catalog = await catalogFor(ctx);
    const model = catalog.models.find((entry) => entry.id === modelId);
    if (!model) return [];
    if (model.supportedVoices === null) {
      return ctx.tts.voiceProfiles
        .filter((profile) => profile.provider === "openrouter" && profile.modelId === modelId && profile.voice)
        .map((profile) => ({ id: profile.voice!, name: profile.name, provider: "openrouter", modelId, vendor: model.vendor, metadata: profile }));
    }
    return modelVoices(model).map((id) => ({
      id,
      name: id,
      provider: "openrouter",
      modelId,
      vendor: model.vendor,
      metadata: { offline: catalog.offline },
    }));
  },
  async synthesize(ctx, request) {
    const resolved = resolveProviderKey(openrouterAdapter, ctx.settings);
    if (!resolved.key) throw new TTSServiceError("OpenRouter needs an API key. Add one in LLM provider settings or enter a TTS-specific key.", "validation");
    if (!request.voice?.trim()) throw new TTSServiceError(`A voice is required for OpenRouter model ${request.model}.`, "validation");

    const catalog = await catalogFor(ctx);
    const model = catalog.models.find((entry) => entry.id === request.model);
    const selectedVoice = resetVoiceForModel(model, request.voice);
    if (selectedVoice.changed) {
      ctx.notice?.(`Voice changed to ${selectedVoice.voice} because ${request.model} does not support the selected voice.`);
    }
    if (!selectedVoice.voice) throw new TTSServiceError(`OpenRouter model ${request.model} has no supported voices.`, "validation");

    const format = request.responseFormat || "mp3";
    const body: Record<string, unknown> = {
      model: request.model,
      input: request.text,
      voice: selectedVoice.voice,
      response_format: format,
    };
    if (modelSupportsParameter(model, "speed")) body.speed = request.speed ?? 1;
    if (request.instructions?.trim()) body.provider = { instructions: request.instructions.trim() };

    try {
      const binary = await fetchBinary("openrouter", OPENROUTER_SPEECH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.key}` },
        body: JSON.stringify(body),
      }, format);
      return {
        audioUrl: URL.createObjectURL(new Blob([binary.data], { type: binary.mimeType || audioMime(format) })),
        audioData: binary.data,
        mimeType: binary.mimeType || audioMime(format),
        rawOutput: { provider: "openrouter", model: request.model, voice: selectedVoice.voice, offlineCatalog: catalog.offline },
      };
    } catch (error) {
      if (error instanceof TTSServiceError && !["auth", "rate_limit"].includes(error.code)) {
        throw new TTSServiceError(`OpenRouter model ${request.model}: ${error.message}`, error.code, error.recoverable);
      }
      throw error;
    }
  },
};
