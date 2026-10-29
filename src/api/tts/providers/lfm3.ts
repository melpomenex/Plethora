import { getInstalledHfModels } from "../../hfModels";
import { generateLfm3Speech } from "../../lfm3Tts";
import { lfm3Language, LFM3_MODEL_ID } from "../../../utils/lfm3Tts";
import { TTSServiceError } from "../errors";
import { binaryResult } from "./shared";
import type { TTSProviderAdapter } from "../types";

export const lfm3Adapter: TTSProviderAdapter = {
  id: "lfm3",
  label: "LFM3 (On-device)",
  kind: "local",
  auth: { mode: "none" },
  canEnumerateModels: true,
  capabilities: {
    supportsSpeed: false,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    supportsWordTimings: false,
    audioFormats: ["wav"],
    maxInputChars: 300,
  },
  async listModels() {
    const installed = (await getInstalledHfModels()).some(
      (m) => m.id === LFM3_MODEL_ID && m.installed
    );
    return [
      {
        id: LFM3_MODEL_ID,
        name: "LFM3 Audio 2B",
        vendor: "Liquid AI",
        supportedVoices: ["female", "male"],
        supportedParameters: ["language"],
        description: installed
          ? "Installed · local speech"
          : "Download the model in Settings to use local speech.",
      },
    ];
  },
  async listVoices(_ctx, modelId) {
    return ["female", "male"].map((voice) => ({
      id: voice,
      name: voice === "female" ? "Female" : "Male",
      provider: "lfm3" as const,
      modelId,
      language: "multilingual",
      gender: voice,
    }));
  },
  async synthesize(ctx, request) {
    if (!["female", "male"].includes(request.voice ?? "female"))
      throw new TTSServiceError("Choose a supported LFM3 voice in Settings.", "validation");
    if (request.model !== LFM3_MODEL_ID)
      throw new TTSServiceError("Select the installed LFM3 Audio model in Settings.", "validation");
    const result = await generateLfm3Speech({
      text: request.text,
      modelId: request.model,
      voice: request.voice ?? "female",
      language: lfm3Language(request.language ?? ctx.config.language),
      signal: request.signal,
    });
    // The desktop CSP permits data URLs for media, but not fetch/connect-src.
    // Decode the native payload locally, then use the normal owned audio URL.
    const prefix = "data:audio/wav;base64,";
    if (!result.audioUrl.startsWith(prefix))
      throw new TTSServiceError("LFM3 returned invalid WAV audio.", "provider");
    const audioData = Uint8Array.from(atob(result.audioUrl.slice(prefix.length)), (c) => c.charCodeAt(0)).buffer;
    return {
      ...binaryResult("lfm3", request.model, "wav", audioData, "audio/wav"),
      durationSec: result.durationSec,
      rawOutput: { provider: "lfm3", model: request.model, backend: result.backend },
    };
  },
};
