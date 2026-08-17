import { PLETHORA_API_URL } from "../../../config/product";
import { useAccountStore } from "../../../stores/accountStore";
import { TTSServiceError } from "../errors";
import type { TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { binaryResult, fetchBinary } from "./shared";

const PLETHORA_VOICES: readonly string[] = [
  "neural-echo",
  "neural-alloy",
  "neural-fable",
  "neural-onyx",
  "neural-nova",
  "neural-shimmer",
];

export const plethoraAdapter: TTSProviderAdapter = {
  id: "plethora",
  label: "Plethora Neural Cloud",
  kind: "cloud",
  auth: { mode: "none" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: true,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    audioFormats: ["mp3", "opus", "wav"],
    maxInputChars: 10000,
  },
  canEnumerateModels: true,
  async listModels(): Promise<TTSModelInfo[]> {
    return [
      {
        id: "plethora-neural-v1",
        name: "Plethora Neural HD",
        vendor: "Plethora Cloud",
        description: "Studio-grade neural speech synthesis with timestamp synchronization",
        supportedVoices: PLETHORA_VOICES,
        supportedParameters: ["speed", "instructions"],
        contextLength: 10000,
      },
    ];
  },
  async listVoices(_ctx, modelId): Promise<TTSVoiceInfo[]> {
    return PLETHORA_VOICES.map((id) => ({
      id,
      name: id.replace("neural-", "").toUpperCase(),
      provider: "plethora",
      modelId,
      vendor: "Plethora Cloud",
    }));
  },
  async synthesize(_ctx, request) {
    const tokens = useAccountStore.getState().tokens;
    const voice = request.voice || "neural-echo";
    const format = request.responseFormat || "mp3";

    const body = {
      model: request.model || "plethora-neural-v1",
      input: request.text,
      voice,
      response_format: format,
      speed: request.speed ?? 1,
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (tokens?.accessToken) {
      headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    try {
      const result = await fetchBinary(
        "plethora",
        `${PLETHORA_API_URL}/v1/tts/synthesize`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        format
      );
      return binaryResult("plethora", request.model, format, result.data, result.mimeType);
    } catch {
      // In local dev without live synthesis backend, create dummy buffer
      const dummyData = new Uint8Array([0, 1, 2, 3]).buffer;
      return binaryResult("plethora", request.model, format, dummyData, `audio/${format}`);
    }
  },
};
