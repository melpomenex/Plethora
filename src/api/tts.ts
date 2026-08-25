import type { Settings } from "../stores/settingsStore";
import { getProviderSettings, type TTSPreset, type TTSSettings, type TTSVoiceProfile } from "../utils/ttsSettings";
import { getCachedAudio, makeCacheKey, makeTTSCacheKeyV2, digestJson128, digestText128, setCachedAudioDurable } from "../utils/ttsCache";
import { getOrCreateTTSGeneration } from "./tts/dedup";
import { resolveProviderKey } from "./tts/auth";
import { TTSServiceError } from "./tts/errors";
import { getAdapter } from "./tts/registry";
import { invokeFalModel } from "./tts/providers/fal";
import { audioMime } from "./tts/providers/shared";
import { chunkTextForTTS } from "../utils/ttsTextExtraction";
import type { WordTiming } from "../utils/wordTimings";
import { foldForMatch } from "../utils/readerSpeechIndex";
import { cloudTtsRequiresConsent, isPaidTtsProvider, requestPaidConsent } from "../utils/aiBillingConsent";
import { createOwnedObjectUrl } from "../diagnostics/ownedObjectUrl";
import { t } from "../lib/i18n";

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
  includeTimings?: boolean;
  signal?: AbortSignal;
  awaitCache?: boolean;
}

export interface GenerateSpeechResult {
  audioUrl: string;
  durationSec?: number;
  rawOutput: Record<string, unknown>;
  wordTimings?: WordTiming[];
  cacheSource?: string;
}

export function getTTSSettingsFromStore(settings: Settings): TTSSettings {
  return settings.tts;
}

export async function resolveTTSMaxChunkSize(settings: Settings): Promise<number> {
  const tts = getTTSSettingsFromStore(settings);
  const adapter = getAdapter(String(tts.provider));
  const config = getProviderSettings(tts, String(tts.provider));
  try {
    const model = (await adapter.listModels({ settings, tts, config })).find((item) => item.id === config.modelId);
    if (model?.contextLength && model.contextLength > 0) return model.contextLength;
  } catch {
  }
  return adapter.capabilities.maxInputChars;
}

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

const PAID_PROVIDERS = new Set(["fal","elevenlabs","openai","openai-compatible","openrouter","plethora","groq"]);

function buildV2Key(tts: TTSSettings, providerId: string, model: string, actualVoice: string, speed: number, format: string, text: string, preset: TTSPreset, voice: TTSVoiceProfile): string {
  const adapter = getAdapter(providerId, () => {});
  const config = getProviderSettings(tts, providerId);
  const supportsInstructions = Boolean(adapter.capabilities.supportsInstructions);
  const supportsLanguage = providerId === "fal";
  const presetDigest = preset.id !== tts.presets[0]?.id ? digestJson128({ prompt: foldForMatch(preset.prompt), temperature: Number(preset.temperature.toFixed(2)), topP: Number(preset.topP.toFixed(2)), topK: preset.topK, repetitionPenalty: Number(preset.repetitionPenalty.toFixed(2)) }) : "";
  const pronDict = tts.pronunciationDictionary && Object.keys(tts.pronunciationDictionary).length ? digestJson128(Object.fromEntries(Object.entries(tts.pronunciationDictionary).sort().map(([k,v])=>[foldForMatch(k), foldForMatch(v)]))) : "";
  const clonedDigest = voice.speakerEmbeddingUrl ? digestText128(voice.speakerEmbeddingUrl) : voice.kind==="cloned" ? digestText128(voice.id) : "";
  const baseUrl = config.baseUrl ?? "";
  return makeTTSCacheKeyV2({ provider: providerId, model, voice: actualVoice, speed, format, text, language: config.language, instructions: config.instructions, presetDigest, pronunciationDigest: pronDict, clonedVoiceDigest: clonedDigest, baseUrl, supportsInstructions, supportsLanguage });
}

/**
 * Gate a billable TTS operation (ai-billing-safety #14): when the provider is
 * a paid/cloud adapter and `paidTtsEnabled` is off, ask for explicit consent.
 * The opt-in surface is registered by the app shell; enabling persists the
 * flag so this runs once, not per chunk. Denied requests throw a typed
 * `paid_consent_required` error the UI maps to the opt-in prompt.
 */
async function ensurePaidTtsConsent(
  settings: Settings,
  providerId: string,
  model: string,
  adapterLabel: string
): Promise<void> {
  if (!isPaidTtsProvider(providerId)) return;
  if (!cloudTtsRequiresConsent(providerId, settings)) return;
  const granted = await requestPaidConsent({
    kind: "tts",
    provider: providerId,
    model,
    label: adapterLabel,
  });
  if (!granted) {
    throw new TTSServiceError(
      t("paid.ttsGenerationBlocked", { label: adapterLabel }),
      "paid_consent_required"
    );
  }
}

async function cacheAudioResultDurable(
  cacheKey: string,
  audioUrl: string,
  audioData: ArrayBuffer | undefined,
  durationSec: number | undefined,
  wordTimings: WordTiming[] | undefined,
  awaitCache: boolean,
): Promise<void> {
  try {
    let buffer = audioData;
    if (!buffer) {
      const response = await fetch(audioUrl);
      if (!response.ok) return;
      buffer = await response.arrayBuffer();
    }
    const p = setCachedAudioDurable(cacheKey, buffer, durationSec ?? 0, wordTimings);
    if (awaitCache) await p;
  } catch {
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
  await ensurePaidTtsConsent(settings, "fal", config.cloneModelId, "Fal");
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
  const legacyKey = makeCacheKey(providerId, model, actualVoice, speed, format, request.text);
  const v2Key = buildV2Key(tts, providerId, model, actualVoice, speed, format, request.text, preset, voice);

  let cached = await getCachedAudio(v2Key);
  if (cached) {
    const audioUrl = createOwnedObjectUrl(new Blob([cached.audioData], { type: audioMime(format) }), {
      owner: "tts-cache-hit",
      ownerId: v2Key,
    });
    if (import.meta.env.DEV) console.debug("[TTS cache]", { key: v2Key, legacyKey, source: "persistent", hasWordTimings: Boolean(cached.wordTimings), durationSec: cached.durationSec });
    return { audioUrl, durationSec: cached.durationSec, wordTimings: cached.wordTimings, rawOutput: { provider: providerId, model, fromCache: true }, cacheSource: "persistent" };
  }
  cached = await getCachedAudio(legacyKey);
  if (cached) {
    const audioUrl = createOwnedObjectUrl(new Blob([cached.audioData], { type: audioMime(format) }), {
      owner: "tts-cache-hit",
      ownerId: v2Key,
    });
    setCachedAudioDurable(v2Key, cached.audioData, cached.durationSec, cached.wordTimings).catch(()=>{});
    if (import.meta.env.DEV) console.debug("[TTS cache]", { key: v2Key, legacyKey, source: "persistent-legacy", hasWordTimings: Boolean(cached.wordTimings), durationSec: cached.durationSec });
    return { audioUrl, durationSec: cached.durationSec, wordTimings: cached.wordTimings, rawOutput: { provider: providerId, model, fromCache: true }, cacheSource: "persistent" };
  }

  const awaitCache = request.awaitCache ?? PAID_PROVIDERS.has(providerId);
  const factory = async (): Promise<GenerateSpeechResult> => {
    // Paid/cloud gate runs only when we actually synthesize (cache miss) —
    // cached audio is never a billable request (ai-billing-safety #14).
    await ensurePaidTtsConsent(settings, providerId, model, adapter.label);
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
      includeTimings: request.includeTimings ?? true,
    });
    await cacheAudioResultDurable(v2Key, result.audioUrl, result.audioData, result.durationSec, result.wordTimings, awaitCache);
    if (import.meta.env.DEV) console.debug("[TTS cache]", { key: v2Key, legacyKey, source: "synthesized", hasWordTimings: Boolean(result.wordTimings), durationSec: result.durationSec });
    return { audioUrl: result.audioUrl, durationSec: result.durationSec, rawOutput: result.rawOutput, wordTimings: result.wordTimings, cacheSource: "synthesized" };
  };

  return getOrCreateTTSGeneration(v2Key, factory, request.signal);
}
