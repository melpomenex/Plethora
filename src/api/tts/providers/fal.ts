import type { Settings } from "../../../stores/settingsStore";
import { getProviderSettings, type TTSSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { mapHttpError, readProviderMessage, TTSServiceError } from "../errors";
import type { TTSAdapterContext, TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";
import { audioMime, runWithRetry } from "./shared";
import { normalizeFalTimestamps } from "../timing";

const DEFAULT_BASE_URL = "https://fal.run";

export async function invokeFalModel(
  settings: Settings,
  tts: TTSSettings,
  modelId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = getProviderSettings(tts, "fal");
  const baseUrl = (config.requestMode === "proxy" ? config.proxyUrl : config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  const resolved = resolveProviderKey({ id: "fal", auth: { mode: "apiKey" } }, settings);
  if (config.requestMode === "direct" && !resolved.key) throw new TTSServiceError("Fal API key is required for direct mode.", "validation");
  return runWithRetry("Fal", async () => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/${modelId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.requestMode === "direct" && resolved.key ? { Authorization: `Key ${resolved.key}` } : {}),
        },
        body: JSON.stringify({ input }),
      });
    } catch (error) {
      throw new TTSServiceError(error instanceof Error ? error.message : "Network error", "network", true);
    }
    let json: unknown = null;
    try { json = await response.json(); } catch { /* handled below */ }
    if (!response.ok) throw mapHttpError("fal", response.status, await readProviderMessage(response));
    if (!json || typeof json !== "object") throw new TTSServiceError("Fal returned an invalid response.", "provider", true);
    if ("data" in json && typeof (json as { data?: unknown }).data === "object") return (json as { data: Record<string, unknown> }).data;
    return json as Record<string, unknown>;
  });
}

export const falAdapter: TTSProviderAdapter = {
  id: "fal",
  label: "Fal.ai",
  kind: "cloud",
  auth: { mode: "apiKey", docsUrl: "https://fal.ai/dashboard/keys" },
  capabilities: {
    supportsSpeed: false,
    supportsInstructions: true,
    supportsCloning: true,
    supportsCustomVoiceIds: false,
    supportsWordTimings: true,
    audioFormats: ["mp3"],
    maxInputChars: 5000,
  },
  canEnumerateModels: false,
  async listModels(ctx): Promise<TTSModelInfo[]> {
    const config = getProviderSettings(ctx.tts, "fal");
    return [{ id: config.modelId, name: config.modelId, vendor: "Fal.ai", supportedVoices: null, supportedParameters: [], contextLength: 0 }];
  },
  async listVoices(ctx, modelId): Promise<TTSVoiceInfo[]> {
    const profiles = ctx.tts.voiceProfiles.filter((profile) => profile.provider === "fal");
    return profiles.filter((profile) => profile.voice || profile.speakerEmbeddingUrl).map((profile) => ({
      id: profile.id,
      name: profile.name,
      provider: "fal",
      modelId,
      vendor: "Fal.ai",
      metadata: profile,
    }));
  },
  async synthesize(ctx, request) {
    const input: Record<string, unknown> = {
      text: request.text,
      prompt: request.preset?.prompt,
      temperature: request.preset?.temperature,
      top_p: request.preset?.topP,
      top_k: request.preset?.topK,
      repetition_penalty: request.preset?.repetitionPenalty,
      max_new_tokens: request.preset?.maxNewTokens,
      language: ctx.config.language,
    };
    const profile = request.voiceProfile;
    if (profile?.kind !== "cloned" && request.voice) input.voice = profile?.voice || request.voice;
    if (profile?.kind === "cloned" && profile.speakerEmbeddingUrl) input.speaker_file_url = profile.speakerEmbeddingUrl;
    const output = await invokeFalModel(ctx.settings, ctx.tts, request.model, input);
    const audio = (output.audio as { url?: string } | undefined)?.url || (output.audio_url as string | undefined) || (output.file as { url?: string } | undefined)?.url;
    if (!audio) throw new TTSServiceError("Fal response did not include playable audio output.", "provider", true);
    // Known timing shapes surfaced in the provider JSON normalize onto the
    // chunk's word boundaries; unknown shapes yield no timings (synthesized
    // fallback covers highlighting).
    const wordTimings = request.includeTimings ? normalizeFalTimestamps(request.text, output) : undefined;
    return { audioUrl: audio, mimeType: audioMime("mp3"), rawOutput: output, wordTimings };
  },
};
