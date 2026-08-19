import { TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";

export const systemAdapter: TTSProviderAdapter = {
  id: "system",
  label: "System TTS",
  kind: "local",
  auth: { mode: "none" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    supportsWordTimings: false,
    audioFormats: [],
    maxInputChars: 5000,
  },
  async listModels(): Promise<TTSModelInfo[]> {
    return [{ id: "system", name: "Device speech engine", vendor: "System", supportedVoices: null, supportedParameters: ["speed"], contextLength: 0 }];
  },
  async listVoices(_ctx, modelId): Promise<TTSVoiceInfo[]> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
    return window.speechSynthesis.getVoices().map((voice, index) => ({
      id: voice.voiceURI || `system-${index}`,
      name: voice.name,
      provider: "system",
      modelId,
      vendor: voice.localService ? "Device" : "Network",
      language: voice.lang,
    }));
  },
  async synthesize(_ctx, _request) {
    throw new TTSServiceError("System TTS is played through the device speech engine.", "validation");
  },
};
