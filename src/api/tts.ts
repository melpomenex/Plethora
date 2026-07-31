import type { Settings } from "../stores/settingsStore";
import { getProviderSettings, type TTSPreset, type TTSSettings, type TTSVoiceProfile } from "../utils/ttsSettings";
import { getCachedAudio, makeCacheKey, setCachedAudio } from "../utils/ttsCache";
import { resolveProviderKey } from "./tts/auth";
import { TTSServiceError } from "./tts/errors";
import { getAdapter } from "./tts/registry";
import { invokeFalModel } from "./tts/providers/fal";
import { audioMime } from "./tts/providers/shared";
import { chunkTextForTTS } from "../utils/ttsTextExtraction";

export { TTSServiceError } from "./tts/errors";

export interface CloneVoiceRequest {
  voiceName: string;
  sampleFile: File;
  sampleText?: string;
}

export interface CloneVoiceResult {
  profile: TTSVoiceProfile;
  rawOutput: Record<string, unknown>;
}

export interface GenerateSpeechRequest {
  text: string;
  voiceId?: string;
  presetId?: string;
}

export interface GenerateSpeechResult {
  audioUrl: string;
  durationSec?: number;
  rawOutput: Record<string, unknown>;
}

export function getTTSSettingsFromStore(settings: Settings): TTSSettings {
  return settings.tts;
}

/** Resolve the selected model's input window, falling back to adapter defaults. */
export async function resolveTTSMaxChunkSize(settings: Settings): Promise<number> {
  const tts = getTTSSettingsFromStore(settings);
  const adapter = getAdapter(String(tts.provider));
  const config = getProviderSettings(tts, String(tts.provider));
  try {
    const model = (await adapter.listModels({ settings, tts, config })).find((item) => item.id === config.modelId);
    if (model?.contextLength && model.contextLength > 0) return model.contextLength;
  } catch {
    // Offline catalogs and local providers use the adapter default.
  }
  return adapter.capabilities.maxInputChars;
}

/** Synchronous helper for callers that already have a catalog model. */
export function chunkSpeechText(text: string, maxChunkSize: number): string[] {
  return chunkTextForTTS(text, maxChunkSize);
}

function resolvePreset(tts: TTSSettings, presetId?: string): TTSPreset {
  const id = presetId || tts.defaultPresetId;
  return tts.presets.find((preset) => preset.id === id) || tts.presets[0];
}

function resolveVoiceProfile(tts: TTSSettings, voiceId: string | undefined, modelId: string, provider: string): TTSVoiceProfile {
  const config = getProviderSettings(tts, provider);
  const requestedId = voiceId || config.voiceId || tts.defaultVoiceId;
  const profile = tts.voiceProfiles.find((voice) =>
    voice.id === requestedId || (voice.provider === provider && voice.voice === requestedId && (!voice.modelId || voice.modelId === modelId)),
  );
  if (profile) return profile;
  return {
    id: requestedId,
    provider: provider as TTSVoiceProfile["provider"],
    name: requestedId,
    kind: provider === "fal" ? "builtin" : "custom",
    voice: requestedId,
    modelId,
    createdAt: new Date(0).toISOString(),
  };
}

function formatForProvider(tts: TTSSettings, provider: string): string {
  const format = getProviderSettings(tts, provider).responseFormat;
  return typeof format === "string" && format.trim() ? format : "mp3";
}

async function cacheAudioResult(
  cacheKey: string,
  audioUrl: string,
  audioData: ArrayBuffer | undefined,
  durationSec: number | undefined,
): Promise<void> {
  try {
    if (audioData) {
      await setCachedAudio(cacheKey, audioData, durationSec ?? 0);
      return;
    }
    const response = await fetch(audioUrl);
    if (response.ok) await setCachedAudio(cacheKey, await response.arrayBuffer(), durationSec ?? 0);
  } catch {
    // Cache writes are best-effort and must not affect playback.
  }
}

export async function cloneVoice(settings: Settings, request: CloneVoiceRequest): Promise<CloneVoiceResult> {
  const tts = getTTSSettingsFromStore(settings);
  if (String(tts.provider) !== "fal") throw new TTSServiceError("Voice cloning is currently available for Fal provider only.", "validation");
  if (!request.voiceName.trim()) throw new TTSServiceError("Voice name is required.", "validation");

  const audioUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new TTSServiceError("Failed to read voice sample file.", "validation"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new TTSServiceError("Voice sample conversion failed.", "validation"));
    reader.readAsDataURL(request.sampleFile);
  });
  const config = getProviderSettings(tts, "fal");
  const output = await invokeFalModel(settings, tts, config.cloneModelId, {
    audio_url: audioUrl,
    text: request.sampleText?.trim() || "This is a voice cloning sample.",
    language: config.language,
  });
  const outputAny = output as { speaker_file?: { url?: string }; speaker_file_url?: string; speaker_embedding_url?: string };
  const speakerEmbeddingUrl = outputAny.speaker_file?.url || outputAny.speaker_file_url || outputAny.speaker_embedding_url;
  if (!speakerEmbeddingUrl) throw new TTSServiceError("Voice cloning response did not include a reusable speaker embedding URL.", "provider", true);
  return {
    profile: {
      id: `fal-cloned-${Date.now()}`,
      provider: "fal",
      name: request.voiceName.trim(),
      kind: "cloned",
      speakerEmbeddingUrl,
      referenceText: request.sampleText?.trim() || "",
      createdAt: new Date().toISOString(),
    },
    rawOutput: output,
  };
}

export async function generateSpeech(settings: Settings, request: GenerateSpeechRequest): Promise<GenerateSpeechResult> {
  const tts = getTTSSettingsFromStore(settings);
  if (!request.text.trim()) throw new TTSServiceError("Text is required for speech generation.", "validation");

  const providerId = String(tts.provider);
  const adapter = getAdapter(providerId, (message) => console.warn(message));
  const config = getProviderSettings(tts, providerId);
  const model = config.modelId;
  const voice = resolveVoiceProfile(tts, request.voiceId, model, providerId);
  const preset = resolvePreset(tts, request.presetId);
  const format = formatForProvider(tts, providerId);
  const speed = config.speed ?? 1;
  const actualVoice = voice.voice || voice.id;
  const cacheKey = makeCacheKey(providerId, model, actualVoice, speed, format, request.text);

  const cached = await getCachedAudio(cacheKey);
  if (cached) {
    const audioUrl = URL.createObjectURL(new Blob([cached.audioData], { type: audioMime(format) }));
    return { audioUrl, durationSec: cached.durationSec, rawOutput: { provider: providerId, model, fromCache: true } };
  }

  const resolvedKey = resolveProviderKey(adapter, settings);
  const result = await adapter.synthesize({
    settings,
    tts,
    config,
    apiKey: resolvedKey.key || undefined,
    borrowedFrom: resolvedKey.source,
    notice: (message) => console.warn(message),
  }, {
    text: request.text,
    model,
    voice: actualVoice,
    responseFormat: format,
    speed,
    instructions: config.instructions,
    preset: preset as unknown as Record<string, unknown>,
    voiceProfile: voice,
  });

  void cacheAudioResult(cacheKey, result.audioUrl, result.audioData, result.durationSec);
  return { audioUrl: result.audioUrl, durationSec: result.durationSec, rawOutput: result.rawOutput };
}
