export const TTS_SETTINGS_SCHEMA_VERSION = 3;

export const FAL_BUILTIN_VOICES = [
  "Vivian",
  "Serena",
  "Uncle_Fu",
  "Dylan",
  "Eric",
  "Ryan",
  "Aiden",
  "Ono_Anna",
  "Sohee",
] as const;

export const GROQ_BUILTIN_VOICES = [
  "Fiora",
  "Arista",
  "Aster",
  "Puck",
  "Aoede",
  "Kore",
  "Leda",
  "Orpheus",
  "Angus",
  "Athena",
  "Helios",
  "Hera",
  "Luna",
  "Orion",
  "Perseus",
  "Stella",
] as const;

export const POCKET_BUILTIN_VOICES = [
  "alba",
  "marius",
  "javert",
  "jean",
  "fantine",
  "cosette",
  "eponine",
  "azelma",
] as const;

export type FalBuiltinVoice = (typeof FAL_BUILTIN_VOICES)[number];
export type GroqBuiltinVoice = (typeof GROQ_BUILTIN_VOICES)[number];
export type PocketBuiltinVoice = (typeof POCKET_BUILTIN_VOICES)[number];

export const FAL_LANGUAGES = [
  "Auto",
  "English",
  "Chinese",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Japanese",
  "Korean",
  "Portuguese",
  "Russian",
] as const;
export type FalLanguage = (typeof FAL_LANGUAGES)[number];

export type TTSProvider =
  | "fal"
  | "groq"
  | "pocket"
  | "system"
  | "openrouter"
  | "elevenlabs"
  | "openai"
  | "openai-compatible"
  | "android";
export type TTSProviderId = TTSProvider;
export type TTSRequestMode = "direct" | "proxy";
export type TTSResponseFormat = "mp3" | "wav" | "pcm" | "opus" | "aac" | string;

export const TTS_PROVIDER_IDS: readonly TTSProvider[] = [
  "fal",
  "groq",
  "pocket",
  "system",
  "openrouter",
  "elevenlabs",
  "openai",
  "openai-compatible",
  "android",
];

export interface TTSPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  maxNewTokens: number;
  readonly: boolean;
}

export interface TTSVoiceProfile {
  id: string;
  provider: TTSProvider;
  name: string;
  kind: "builtin" | "cloned" | "custom";
  voice?: string;
  modelId?: string;
  vendor?: string;
  language?: string;
  gender?: string;
  style?: string;
  speakerEmbeddingUrl?: string;
  referenceText?: string;
  createdAt: string;
}

export interface TTSProviderSettings {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  voiceId: string;
  responseFormat: TTSResponseFormat;
  speed: number;
  instructions: string;
  requestMode: TTSRequestMode;
  proxyUrl: string;
  cloneModelId: string;
  language: FalLanguage;
  pocketSpeed: number;
  pocketAvailable: boolean;
}

export type TTSProviderSettingsMap = Record<TTSProvider, TTSProviderSettings>;

export interface TTSSettings {
  schemaVersion: number;
  enabled: boolean;
  /** Unknown persisted ids are intentionally retained for a non-blocking registry notice. */
  provider: TTSProvider | (string & {});
  providers: TTSProviderSettingsMap;
  defaultVoiceId: string;
  defaultPresetId: string;
  voiceProfiles: TTSVoiceProfile[];
  presets: TTSPreset[];
  favorites: string[];
  recents: string[];

  // Deprecated v2 mirrors. They remain readable for older integrations, but
  // new code reads the selected entry in `providers`.
  requestMode: TTSRequestMode;
  apiKey: string;
  proxyUrl: string;
  modelId: string;
  cloneModelId: string;
  groqModelId: string;
  groqResponseFormat: "wav" | "mp3";
  language: FalLanguage;
  pocketSpeed: number;
  pocketAvailable: boolean;
}

export const DEFAULT_TTS_PRESETS: TTSPreset[] = [
  {
    id: "balanced-default",
    name: "Balanced",
    description: "Natural cadence for most narration and review cards.",
    prompt: "Clear and natural narration.",
    temperature: 0.9,
    topP: 1,
    topK: 50,
    repetitionPenalty: 1.05,
    maxNewTokens: 200,
    readonly: true,
  },
  {
    id: "expressive-story",
    name: "Expressive",
    description: "More dynamic style for storytelling and engaging reads.",
    prompt: "Expressive voice with emotional range and emphasis.",
    temperature: 1,
    topP: 1,
    topK: 60,
    repetitionPenalty: 1.03,
    maxNewTokens: 240,
    readonly: true,
  },
  {
    id: "fast-review",
    name: "Fast",
    description: "Compact and efficient delivery for quick review sessions.",
    prompt: "Concise and steady speech with minimal pauses.",
    temperature: 0.8,
    topP: 0.95,
    topK: 40,
    repetitionPenalty: 1.08,
    maxNewTokens: 180,
    readonly: true,
  },
];

function defaultProviderSettings(
  overrides: Partial<TTSProviderSettings> = {}
): TTSProviderSettings {
  return {
    apiKey: "",
    baseUrl: "",
    modelId: "",
    voiceId: "",
    responseFormat: "mp3",
    speed: 1,
    instructions: "",
    requestMode: "direct",
    proxyUrl: "",
    cloneModelId: "",
    language: "Auto",
    pocketSpeed: 1,
    pocketAvailable: false,
    ...overrides,
  };
}

function makeProviderSettings(): TTSProviderSettingsMap {
  return {
    fal: defaultProviderSettings({
      modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      cloneModelId: "fal-ai/qwen-3-tts/clone-voice/1.7b",
      voiceId: "Vivian",
    }),
    groq: defaultProviderSettings({ modelId: "playai-tts", voiceId: "Fiora" }),
    pocket: defaultProviderSettings({ modelId: "pocket-tts", voiceId: "alba" }),
    system: defaultProviderSettings({ modelId: "system", voiceId: "system-default" }),
    openrouter: defaultProviderSettings({ modelId: "hexgrad/kokoro-82m", voiceId: "af_bella" }),
    elevenlabs: defaultProviderSettings({ modelId: "eleven_multilingual_v2", voiceId: "Rachel" }),
    openai: defaultProviderSettings({ modelId: "gpt-4o-mini-tts", voiceId: "alloy" }),
    "openai-compatible": defaultProviderSettings({
      baseUrl: "http://localhost:8000/v1",
      modelId: "tts-1",
      voiceId: "alloy",
    }),
    // Native Android on-device TTS (sherpa-onnx). KittenTTS Micro is the
    // compact default; Kokoro-82M is the optional higher-quality model.
    // The modelId tracks the active downloaded model; voiceId is the speaker
    // index. Desktop ignores this entry entirely (provider is hidden via
    // isNativeMobile()).
    android: defaultProviderSettings({ modelId: "kitten-nano", voiceId: "0" }),
  };
}

export function makeDefaultTTSVoiceProfiles(): TTSVoiceProfile[] {
  const falVoices = FAL_BUILTIN_VOICES.map((voice) => ({
    id: `fal-builtin-${voice}`,
    provider: "fal" as const,
    name: voice.replace(/_/g, " "),
    kind: "builtin" as const,
    voice,
    createdAt: new Date(0).toISOString(),
  }));
  const groqVoices = GROQ_BUILTIN_VOICES.map((voice) => ({
    id: `groq-builtin-${voice.toLowerCase()}`,
    provider: "groq" as const,
    name: voice,
    kind: "builtin" as const,
    voice,
    createdAt: new Date(0).toISOString(),
  }));
  const pocketVoices = POCKET_BUILTIN_VOICES.map((voice) => ({
    id: `pocket-builtin-${voice}`,
    provider: "pocket" as const,
    name: voice.charAt(0).toUpperCase() + voice.slice(1),
    kind: "builtin" as const,
    voice,
    createdAt: new Date(0).toISOString(),
  }));
  return [...falVoices, ...groqVoices, ...pocketVoices];
}

export function defaultVoiceIdForProvider(provider: string): string {
  switch (provider) {
    case "groq":
      return "groq-builtin-fiora";
    case "pocket":
      return "pocket-builtin-alba";
    case "system":
      return "system-default";
    case "openrouter":
      return "af_bella";
    case "elevenlabs":
      return "Rachel";
    case "openai":
      return "alloy";
    case "openai-compatible":
      return "alloy";
    case "android":
      return "0";
    default:
      return "fal-builtin-Vivian";
  }
}

function legacyMirrors(
  provider: string,
  providers: TTSProviderSettingsMap
): Pick<
  TTSSettings,
  | "requestMode"
  | "apiKey"
  | "proxyUrl"
  | "modelId"
  | "cloneModelId"
  | "groqModelId"
  | "groqResponseFormat"
  | "language"
  | "pocketSpeed"
  | "pocketAvailable"
> {
  const selected = providers[provider as TTSProvider] || providers.fal;
  return {
    requestMode: selected.requestMode,
    apiKey: selected.apiKey,
    proxyUrl: selected.proxyUrl,
    modelId: providers.fal.modelId,
    cloneModelId: providers.fal.cloneModelId,
    groqModelId: providers.groq.modelId,
    groqResponseFormat: providers.groq.responseFormat === "wav" ? "wav" : "mp3",
    language: providers.fal.language,
    pocketSpeed: providers.pocket.pocketSpeed,
    pocketAvailable: providers.pocket.pocketAvailable,
  };
}

export function createDefaultTTSSettings(): TTSSettings {
  const providers = makeProviderSettings();
  return {
    schemaVersion: TTS_SETTINGS_SCHEMA_VERSION,
    enabled: false,
    provider: "fal",
    providers,
    defaultVoiceId: "fal-builtin-Vivian",
    defaultPresetId: DEFAULT_TTS_PRESETS[0].id,
    voiceProfiles: makeDefaultTTSVoiceProfiles(),
    presets: DEFAULT_TTS_PRESETS,
    favorites: [],
    recents: [],
    ...legacyMirrors("fal", providers),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function asNonEmptyString(value: unknown, fallback: string): string {
  const valueString = asString(value).trim();
  return valueString || fallback;
}
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}
function providerId(value: unknown, fallback = "fal"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
function capIds(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    ),
  ].slice(0, max);
}

function normalizeVoiceProfiles(
  persisted: unknown,
  defaults: TTSVoiceProfile[]
): TTSVoiceProfile[] {
  const base = new Map(defaults.map((profile) => [profile.id, profile]));
  if (!Array.isArray(persisted)) return [...base.values()];
  for (const item of persisted) {
    if (!isObject(item)) continue;
    const id = asNonEmptyString(item.id, "");
    const name = asNonEmptyString(item.name, "");
    if (!id || !name) continue;
    const provider = providerId(item.provider, "fal") as TTSProvider;
    const kind = item.kind === "cloned" ? "cloned" : item.kind === "custom" ? "custom" : "builtin";
    const profile: TTSVoiceProfile = {
      id,
      provider,
      name,
      kind,
      voice: typeof item.voice === "string" ? item.voice : undefined,
      modelId: typeof item.modelId === "string" ? item.modelId : undefined,
      vendor: typeof item.vendor === "string" ? item.vendor : undefined,
      language: typeof item.language === "string" ? item.language : undefined,
      gender: typeof item.gender === "string" ? item.gender : undefined,
      style: typeof item.style === "string" ? item.style : undefined,
      speakerEmbeddingUrl:
        typeof item.speakerEmbeddingUrl === "string" ? item.speakerEmbeddingUrl : undefined,
      referenceText: typeof item.referenceText === "string" ? item.referenceText : undefined,
      createdAt: asString(item.createdAt, new Date().toISOString()),
    };
    if (kind === "cloned" && !profile.speakerEmbeddingUrl) continue;
    if (kind === "builtin" && !profile.voice) continue;
    if (
      (kind === "custom" ||
        provider === "openrouter" ||
        provider === "elevenlabs" ||
        provider === "openai" ||
        provider === "openai-compatible") &&
      !profile.voice
    )
      continue;
    base.set(profile.id, profile);
  }
  return [...base.values()];
}

function normalizePresets(persisted: unknown, defaults: TTSPreset[]): TTSPreset[] {
  if (!Array.isArray(persisted)) return defaults;
  const out: TTSPreset[] = [];
  for (const item of persisted) {
    if (!isObject(item)) continue;
    const id = asNonEmptyString(item.id, "");
    const name = asNonEmptyString(item.name, "");
    if (!id || !name) continue;
    out.push({
      id,
      name,
      description: asString(item.description),
      prompt: asString(item.prompt),
      temperature: clampNumber(item.temperature, 0.9, 0.1, 2),
      topP: clampNumber(item.topP, 1, 0.1, 1),
      topK: Math.round(clampNumber(item.topK, 50, 1, 200)),
      repetitionPenalty: clampNumber(item.repetitionPenalty, 1.05, 0.9, 2),
      maxNewTokens: Math.round(clampNumber(item.maxNewTokens, 200, 20, 1000)),
      readonly: Boolean(item.readonly),
    });
  }
  if (!out.length) return defaults;
  const merged = new Map(out.map((preset) => [preset.id, preset]));
  for (const preset of defaults) if (!merged.has(preset.id)) merged.set(preset.id, preset);
  return [...merged.values()];
}

function normalizeProviderSettings(
  provider: TTSProvider,
  persisted: unknown,
  defaults: TTSProviderSettings
): TTSProviderSettings {
  const item = isObject(persisted) ? persisted : {};
  const responseFormat = asString(item.responseFormat, defaults.responseFormat);
  const language = (FAL_LANGUAGES as readonly string[]).includes(asString(item.language))
    ? (asString(item.language) as FalLanguage)
    : defaults.language;
  return {
    apiKey: asString(item.apiKey, defaults.apiKey),
    baseUrl: asString(item.baseUrl, defaults.baseUrl),
    modelId: asNonEmptyString(item.modelId, defaults.modelId),
    voiceId: asString(item.voiceId, defaults.voiceId),
    responseFormat: responseFormat || defaults.responseFormat,
    speed: clampNumber(item.speed, defaults.speed, 0.25, 4),
    instructions: asString(item.instructions, defaults.instructions),
    requestMode: item.requestMode === "proxy" ? "proxy" : "direct",
    proxyUrl: asString(item.proxyUrl, defaults.proxyUrl),
    cloneModelId: asNonEmptyString(item.cloneModelId, defaults.cloneModelId),
    language,
    pocketSpeed: clampNumber(item.pocketSpeed, defaults.pocketSpeed, 0.5, 2),
    pocketAvailable:
      typeof item.pocketAvailable === "boolean" ? item.pocketAvailable : defaults.pocketAvailable,
  };
}

/** Convert the flat schema-2 fields into their provider-scoped homes. */
export function migrateTTSSettings(input: unknown): Record<string, unknown> {
  if (!isObject(input)) return createDefaultTTSSettings() as unknown as Record<string, unknown>;
  const defaults = createDefaultTTSSettings();
  const hasV3Providers = input.schemaVersion === 3 && isObject(input.providers);
  if (hasV3Providers) return input;

  const providers = { ...defaults.providers };
  providers.fal = {
    ...providers.fal,
    apiKey: asString(input.apiKey, providers.fal.apiKey),
    modelId: asNonEmptyString(input.modelId, providers.fal.modelId),
    cloneModelId: asNonEmptyString(input.cloneModelId, providers.fal.cloneModelId),
    requestMode: input.requestMode === "proxy" ? "proxy" : "direct",
    proxyUrl: asString(input.proxyUrl, providers.fal.proxyUrl),
    language: (FAL_LANGUAGES as readonly string[]).includes(asString(input.language))
      ? (asString(input.language) as FalLanguage)
      : providers.fal.language,
  };
  providers.groq = {
    ...providers.groq,
    modelId: asNonEmptyString(input.groqModelId, providers.groq.modelId),
    responseFormat: input.groqResponseFormat === "wav" ? "wav" : "mp3",
    apiKey: asString(input.apiKey, providers.groq.apiKey),
  };
  providers.pocket = {
    ...providers.pocket,
    pocketSpeed: clampNumber(input.pocketSpeed, providers.pocket.pocketSpeed, 0.5, 2),
    pocketAvailable: Boolean(input.pocketAvailable),
  };

  return {
    ...input,
    schemaVersion: TTS_SETTINGS_SCHEMA_VERSION,
    providers,
  };
}

export function getProviderSettings(
  settings: TTSSettings,
  provider = String(settings.provider)
): TTSProviderSettings {
  const defaults =
    createDefaultTTSSettings().providers[provider as TTSProvider] ||
    createDefaultTTSSettings().providers.fal;
  const persisted = settings.providers?.[provider as TTSProvider];
  const normalized = normalizeProviderSettings(provider as TTSProvider, persisted, defaults);
  // Compatibility with v2-shaped objects constructed by integrations/tests.
  if (provider === "fal") {
    normalized.apiKey = normalized.apiKey || settings.apiKey || "";
    normalized.modelId = settings.modelId || normalized.modelId;
    normalized.cloneModelId = settings.cloneModelId || normalized.cloneModelId;
    normalized.requestMode = settings.requestMode || normalized.requestMode;
    normalized.proxyUrl = settings.proxyUrl || normalized.proxyUrl;
    normalized.language = settings.language || normalized.language;
  } else if (provider === "groq") {
    normalized.apiKey = normalized.apiKey || settings.apiKey || "";
    normalized.modelId = settings.groqModelId || normalized.modelId;
    normalized.responseFormat = settings.groqResponseFormat || normalized.responseFormat;
  } else if (provider === "pocket") {
    normalized.pocketSpeed = settings.pocketSpeed ?? normalized.pocketSpeed;
    normalized.pocketAvailable = settings.pocketAvailable ?? normalized.pocketAvailable;
  }
  return normalized;
}

export function sanitizeTTSSettings(input: unknown): TTSSettings {
  const defaults = createDefaultTTSSettings();
  const migrated = migrateTTSSettings(input);
  if (!isObject(migrated)) return defaults;
  const provider = providerId(migrated.provider, defaults.provider);
  const rawProviders = isObject(migrated.providers) ? migrated.providers : {};
  const providers = {} as TTSProviderSettingsMap;
  for (const id of TTS_PROVIDER_IDS) {
    providers[id] = normalizeProviderSettings(id, rawProviders[id], defaults.providers[id]);
  }

  const voiceProfiles = normalizeVoiceProfiles(migrated.voiceProfiles, defaults.voiceProfiles);
  const presets = normalizePresets(migrated.presets, defaults.presets);
  const defaultVoiceCandidate =
    asString(migrated.defaultVoiceId, "") ||
    getProviderSettings({ ...defaults, providers, provider } as TTSSettings, provider).voiceId ||
    defaultVoiceIdForProvider(provider);
  const selectedProviderProfiles = voiceProfiles.filter((profile) => profile.provider === provider);
  const defaultVoiceId =
    defaultVoiceCandidate || selectedProviderProfiles[0]?.id || defaultVoiceIdForProvider(provider);
  const defaultPresetIdCandidate = asString(migrated.defaultPresetId, defaults.defaultPresetId);
  const defaultPresetId = presets.some((preset) => preset.id === defaultPresetIdCandidate)
    ? defaultPresetIdCandidate
    : defaults.defaultPresetId;

  const result: TTSSettings = {
    schemaVersion: TTS_SETTINGS_SCHEMA_VERSION,
    enabled: Boolean(migrated.enabled),
    provider,
    providers,
    defaultVoiceId,
    defaultPresetId,
    voiceProfiles,
    presets,
    favorites: capIds(migrated.favorites),
    recents: capIds(migrated.recents),
    ...legacyMirrors(provider, providers),
  };
  return result;
}

export function getVoicesForProvider(
  settings: TTSSettings,
  provider = String(settings.provider)
): TTSVoiceProfile[] {
  return settings.voiceProfiles.filter((voice) => voice.provider === provider);
}

export function validateTTSConfiguration(settings: TTSSettings): {
  valid: boolean;
  error?: string;
} {
  if (!settings.enabled) return { valid: true };
  const provider = String(settings.provider);
  if (provider === "pocket" || provider === "system") return { valid: true };
  const config = getProviderSettings(settings, provider);
  if (provider === "fal" && config.requestMode === "proxy" && !config.proxyUrl.trim()) {
    return { valid: false, error: "Proxy URL is required for proxy mode." };
  }
  if (provider === "fal" && config.requestMode === "proxy") return { valid: true };
  if (config.apiKey.trim()) return { valid: true };
  if (provider === "groq") return { valid: true };
  if (provider === "openrouter") {
    try {
      const raw = localStorage.getItem("llm-providers-storage");
      const parsed = raw
        ? (JSON.parse(raw) as {
            state?: { providers?: Array<{ provider?: string; apiKey?: string }> };
          })
        : null;
      const candidates = parsed?.state?.providers || [];
      const hasBorrowedKey =
        candidates.some(
          (candidate) => candidate.provider === "openrouter" && Boolean(candidate.apiKey?.trim())
        ) || candidates.some((candidate) => Boolean(candidate.apiKey?.trim()));
      if (hasBorrowedKey) return { valid: true };
    } catch {
      // Treat unavailable storage as an unconfigured borrowed provider.
    }
    return {
      valid: false,
      error:
        "OpenRouter needs an API key. Add one in LLM provider settings or enter a TTS-specific key.",
    };
  }
  const labels: Record<string, string> = {
    elevenlabs: "ElevenLabs",
    openai: "OpenAI",
    "openai-compatible": "OpenAI-compatible provider",
  };
  return { valid: false, error: `${labels[provider] || provider} API key is required.` };
}
