import type {
  LogicalSttModelKey,
  SttModelSelection,
  SttProviderCategory,
  TranscriptionMode,
  TranscriptionPricing,
  TranscriptionProviderId,
  TranscriptionRoutingContext,
} from "./types";
import { TranscriptionMode as Mode } from "./types";

/** Logical model registry — maps user-facing model keys to execution targets. */
export const LOGICAL_STT_MODEL_KEYS = {
  NEMOTRON: "nemotron-3.5-asr-0.6b",
  QWEN_06: "qwen3-asr-0.6b",
  QWEN_17: "qwen3-asr-1.7b",
  WHISPER_LOCAL: "whisper-local",
} as const satisfies Record<string, LogicalSttModelKey>;

export interface LogicalSttModelDefinition {
  key: LogicalSttModelKey;
  displayName: string;
  openRouterModelId?: string;
  cloudProviderId?: TranscriptionProviderId;
  localProviderId?: TranscriptionProviderId;
}

export const LOGICAL_STT_MODELS: Record<LogicalSttModelKey, LogicalSttModelDefinition> = {
  [LOGICAL_STT_MODEL_KEYS.NEMOTRON]: {
    key: LOGICAL_STT_MODEL_KEYS.NEMOTRON,
    displayName: "NVIDIA Nemotron 3.5 ASR 0.6B",
    openRouterModelId: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
    cloudProviderId: "openrouter:nemotron-3.5",
    localProviderId: "local:nemotron-3.5",
  },
  [LOGICAL_STT_MODEL_KEYS.QWEN_06]: {
    key: LOGICAL_STT_MODEL_KEYS.QWEN_06,
    displayName: "Qwen3 ASR 0.6B",
    openRouterModelId: "qwen/qwen3-asr-0.6b",
    cloudProviderId: "openrouter:qwen3-asr-0.6b",
  },
  [LOGICAL_STT_MODEL_KEYS.QWEN_17]: {
    key: LOGICAL_STT_MODEL_KEYS.QWEN_17,
    displayName: "Qwen3 ASR 1.7B",
    openRouterModelId: "qwen/qwen3-asr-1.7b",
    cloudProviderId: "openrouter:qwen3-asr-1.7b",
  },
  [LOGICAL_STT_MODEL_KEYS.WHISPER_LOCAL]: {
    key: LOGICAL_STT_MODEL_KEYS.WHISPER_LOCAL,
    displayName: "Local Whisper",
    localProviderId: "local:whisper",
  },
};

/** Remote/local configurable OpenRouter STT defaults (`stt.openrouter.defaultModel`). */
export interface SttOpenRouterConfig {
  defaultModel: string;
}

export const DEFAULT_STT_OPENROUTER_CONFIG: SttOpenRouterConfig = {
  defaultModel: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
};

let sttOpenRouterConfig: SttOpenRouterConfig = { ...DEFAULT_STT_OPENROUTER_CONFIG };

export function getSttOpenRouterConfig(): SttOpenRouterConfig {
  return sttOpenRouterConfig;
}

export function setSttOpenRouterConfig(partial: Partial<SttOpenRouterConfig>): void {
  sttOpenRouterConfig = { ...sttOpenRouterConfig, ...partial };
}

export function resolveOpenRouterDefaultProviderId(): TranscriptionProviderId {
  const modelId = sttOpenRouterConfig.defaultModel;
  const entry = Object.values(LOGICAL_STT_MODELS).find((m) => m.openRouterModelId === modelId);
  return entry?.cloudProviderId ?? TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON;
}

/** Configuration-driven provider identifiers. */
export const TRANSCRIPTION_PROVIDER_IDS = {
  OPENROUTER_NEMOTRON: "openrouter:nemotron-3.5",
  OPENROUTER_QWEN_06: "openrouter:qwen3-asr-0.6b",
  OPENROUTER_QWEN_17: "openrouter:qwen3-asr-1.7b",
  LOCAL_NEMOTRON: "local:nemotron-3.5",
  LOCAL_WHISPER: "local:whisper",
  LEGACY_GROQ: "legacy:groq",
  GEMINI_TRANSCRIBE: "gemini-transcribe",
  GEMINI_LIVE: "gemini-live",
  DEEPGRAM_NOVA3: "deepgram-nova3",
} as const satisfies Record<string, TranscriptionProviderId>;

/** OpenRouter speech-to-text endpoint (OpenAI-compatible multipart + JSON). */
export const OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

/** Gemini OpenAI-compatible speech-to-text endpoint. */
export const GEMINI_TRANSCRIPTION_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
export const GEMINI_TRANSCRIPTION_URL = `${GEMINI_TRANSCRIPTION_BASE_URL}/audio/transcriptions`;
export const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-preview";
export const GEMINI_LIVE_MODEL = "gemini-3.5-transcribe-live-preview";

/** Deepgram REST + streaming endpoints. */
export const DEEPGRAM_API_BASE = "https://api.deepgram.com/v1";
export const DEEPGRAM_LISTEN_URL = `${DEEPGRAM_API_BASE}/listen`;
export const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";
export const DEEPGRAM_NOVA3_MODEL = "nova-3";

/** Default monthly premium transcription allowance (minutes). */
export const DEFAULT_PREMIUM_MONTHLY_ALLOWANCE_MINUTES = 120;

/** OpenRouter ASR model strings (not scattered in provider code). */
export const OPENROUTER_ASR_MODELS = {
  NEMOTRON: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
  QWEN_06: "qwen/qwen3-asr-0.6b",
  QWEN_17: "qwen/qwen3-asr-1.7b",
} as const;

/** @deprecated Use OPENROUTER_ASR_MODELS.NEMOTRON */
export const OPENROUTER_NEMOTRON_MODEL = OPENROUTER_ASR_MODELS.NEMOTRON;

export const OPENROUTER_PROVIDER_TO_MODEL: Record<string, string> = {
  [TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON]: OPENROUTER_ASR_MODELS.NEMOTRON,
  [TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06]: OPENROUTER_ASR_MODELS.QWEN_06,
  [TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_17]: OPENROUTER_ASR_MODELS.QWEN_17,
};

export const TRANSCRIPTION_PRICING: Record<TranscriptionProviderId, TranscriptionPricing> = {
  "openrouter:nemotron-3.5": { costPerHour: 0.01, currency: "USD", tier: "inexpensive" },
  "openrouter:qwen3-asr-0.6b": { costPerHour: 0.01, currency: "USD", tier: "inexpensive" },
  "openrouter:qwen3-asr-1.7b": { costPerHour: 0.015, currency: "USD", tier: "inexpensive" },
  "local:nemotron-3.5": { costPerHour: 0, currency: "USD", tier: "free" },
  "local:whisper": { costPerHour: 0, currency: "USD", tier: "free" },
  "legacy:groq": { costPerHour: 0.04, currency: "USD", tier: "standard" },
  "gemini-transcribe": { costPerHour: 0.25, currency: "USD", tier: "premium" },
  "gemini-live": { costPerHour: 0.35, currency: "USD", tier: "premium" },
  "deepgram-nova3": { costPerHour: 0.3, currency: "USD", tier: "premium" },
};

export const PREMIUM_PROVIDER_IDS = new Set<TranscriptionProviderId>([
  TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
  TRANSCRIPTION_PROVIDER_IDS.GEMINI_LIVE,
  TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3,
]);

export const INEXPENSIVE_CLOUD_PROVIDER_IDS = new Set<TranscriptionProviderId>([
  TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON,
  TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06,
  TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_17,
]);

/** Default provider chains per mode (configuration-driven). */
export function getDefaultProviderChains(): Record<TranscriptionMode, readonly TranscriptionProviderId[]> {
  const cloudDefault = resolveOpenRouterDefaultProviderId();
  const inexpensiveCloud: TranscriptionProviderId[] = [
    cloudDefault,
    TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06,
    TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_17,
  ].filter((id, index, arr) => arr.indexOf(id) === index);

  return {
    [Mode.Auto]: [
      ...inexpensiveCloud,
      TRANSCRIPTION_PROVIDER_IDS.LEGACY_GROQ,
    ],
    [Mode.Fast]: inexpensiveCloud,
    [Mode.Enhanced]: [TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE],
    [Mode.Realtime]: [
      TRANSCRIPTION_PROVIDER_IDS.GEMINI_LIVE,
      TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3,
    ],
    [Mode.Offline]: [
      TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON,
      TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER,
    ],
  };
}

/** @deprecated Use getDefaultProviderChains() for dynamic default model support. */
export const DEFAULT_PROVIDER_CHAINS: Record<TranscriptionMode, readonly TranscriptionProviderId[]> =
  getDefaultProviderChains();

export const ROUTER_DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 500,
  healthFailureThreshold: 3,
  healthWindowMs: 5 * 60 * 1000,
} as const;

/**
 * Map legacy `audioTranscription.provider` to a transcription mode until
 * settingsStore migration lands in Phase 2.
 */
export function legacyProviderToMode(
  provider: "local" | "groq" | "apple" | "android-ondevice",
): TranscriptionMode {
  if (provider === "local") return Mode.Offline;
  if (provider === "groq") return Mode.Fast;
  return Mode.Auto;
}

/** Resolve transcription mode from settings, preferring explicit `mode` over legacy provider. */
export function resolveTranscriptionMode(
  audio: {
    mode?: string;
    provider: "local" | "groq" | "apple" | "android-ondevice";
  },
): TranscriptionMode {
  switch (audio.mode) {
    case Mode.Auto:
    case Mode.Fast:
    case Mode.Enhanced:
    case Mode.Realtime:
    case Mode.Offline:
      return audio.mode;
    default:
      return legacyProviderToMode(audio.provider);
  }
}

export function buildRoutingContext(
  partial: Partial<TranscriptionRoutingContext> & { mode?: TranscriptionMode },
): TranscriptionRoutingContext {
  return {
    mode: partial.mode ?? Mode.Auto,
    sttProvider: partial.sttProvider,
    sttModel: partial.sttModel,
    preferLocal: partial.preferLocal ?? true,
    automaticFallback: partial.automaticFallback ?? true,
    forceOffline: partial.forceOffline ?? false,
    allowPremiumFallback: partial.allowPremiumFallback ?? false,
    legacyGroqEnabled: partial.legacyGroqEnabled ?? true,
    requiredCapabilities: partial.requiredCapabilities,
    healthState: partial.healthState,
    localNemotronInstalled: partial.localNemotronInstalled,
  };
}

/** Map legacy transcription mode to provider category. */
export function sttProviderFromMode(mode: TranscriptionMode): SttProviderCategory {
  switch (mode) {
    case Mode.Offline:
      return "local";
    case Mode.Enhanced:
    case Mode.Realtime:
      return "premium";
    case Mode.Fast:
      return "openrouter";
    default:
      return "automatic";
  }
}

/** Map provider category to a compatible legacy mode for router chains. */
export function modeFromSttProvider(provider: SttProviderCategory): TranscriptionMode {
  switch (provider) {
    case "local":
      return Mode.Offline;
    case "openrouter":
      return Mode.Fast;
    case "premium":
      return Mode.Enhanced;
    default:
      return Mode.Auto;
  }
}

export function resolveLogicalModelProviderIds(
  model: SttModelSelection,
  execution: "cloud" | "local",
): TranscriptionProviderId[] {
  if (model === "automatic") return [];
  const definition = LOGICAL_STT_MODELS[model as LogicalSttModelKey];
  if (!definition) return [];
  if (execution === "local" && definition.localProviderId) {
    return [definition.localProviderId];
  }
  if (execution === "cloud" && definition.cloudProviderId) {
    return [definition.cloudProviderId];
  }
  return [];
}

export interface AudioTranscriptionRoutingInput {
  mode?: string;
  provider: "local" | "groq" | "apple" | "android-ondevice";
  sttProvider?: SttProviderCategory;
  sttModel?: SttModelSelection;
  preferLocal?: boolean;
  automaticFallback?: boolean;
  openrouter?: { defaultModel?: string };
}

/** Resolve provider category from settings, preferring explicit `sttProvider`. */
export function resolveSttProvider(audio: AudioTranscriptionRoutingInput): SttProviderCategory {
  if (audio.sttProvider) return audio.sttProvider;
  return sttProviderFromMode(resolveTranscriptionMode(audio));
}

export function resolveSttModel(audio: AudioTranscriptionRoutingInput): SttModelSelection {
  return audio.sttModel ?? "automatic";
}

/** Build routing context from persisted audio transcription settings. */
export function buildRoutingContextFromSettings(
  audio: AudioTranscriptionRoutingInput,
  partial?: Partial<TranscriptionRoutingContext>,
): TranscriptionRoutingContext {
  const sttProvider = resolveSttProvider(audio);
  const mode = partial?.mode ?? modeFromSttProvider(sttProvider);
  if (audio.openrouter?.defaultModel) {
    setSttOpenRouterConfig({ defaultModel: audio.openrouter.defaultModel });
  }
  return buildRoutingContext({
    mode,
    sttProvider,
    sttModel: resolveSttModel(audio),
    preferLocal: audio.preferLocal ?? true,
    automaticFallback: audio.automaticFallback ?? true,
    legacyGroqEnabled: partial?.legacyGroqEnabled,
    forceOffline: sttProvider === "local" || partial?.forceOffline,
    allowPremiumFallback: partial?.allowPremiumFallback,
    healthState: partial?.healthState,
    localNemotronInstalled: partial?.localNemotronInstalled,
  });
}
