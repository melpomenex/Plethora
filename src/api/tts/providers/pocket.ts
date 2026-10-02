import { checkPocketTTSAvailable, generatePocketSpeech } from "../../pocketTts";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { TTSServiceError } from "../errors";

import { POCKET_BUILTIN_VOICES } from "../../../utils/ttsSettings";

export const pocketAdapter: TTSProviderAdapter = {
  id: "pocket",
  label: "Pocket TTS",
  kind: "local",
  auth: { mode: "none" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    supportsWordTimings: false,
    audioFormats: ["wav"],
    maxInputChars: 5000,
  },
  async listModels(): Promise<TTSModelInfo[]> {
    const status = await checkPocketTTSAvailable();
    const description = status.state === "installed" ? "Available offline" : status.error ?? undefined;
    return [{ id: "pocket-tts", name: "Pocket TTS", vendor: "Kyutai", supportedVoices: null, supportedParameters: ["speed"], contextLength: 0, description }];
  },
  async listVoices(ctx, modelId): Promise<TTSVoiceInfo[]> {
    const configured = (ctx.tts?.voiceProfiles || [])
      .filter((profile) => profile.provider === "pocket" && profile.voice)
      .map((profile) => ({ id: profile.voice!, name: profile.name, provider: "pocket" as const, modelId, vendor: "Pocket TTS" }));
    if (configured.length > 0) return configured;
    return POCKET_BUILTIN_VOICES.map((v) => ({
      id: v,
      name: v.charAt(0).toUpperCase() + v.slice(1),
      provider: "pocket" as const,
      modelId,
      vendor: "Pocket TTS",
    }));
  },
  async synthesize(ctx, request) {
    try {
      const result = await generatePocketSpeech({ text: request.text, voice: request.voice || "alba", speed: request.speed ?? 1 });
      return { audioUrl: result.audioUrl, durationSec: result.durationSec, rawOutput: { provider: "pocket", voice: request.voice || "alba" } };
    } catch (error) {
      throw new TTSServiceError(error instanceof Error ? error.message : "Pocket TTS failed.", "provider", true);
    }
  },
};
