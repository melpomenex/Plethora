import type { Settings } from "../../stores/settingsStore";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../stores/llmProvidersStore";
import type { TTSSettings } from "../../utils/ttsSettings";
import type { TTSAdapterAuth, TTSProviderAdapter } from "./types";

export type TTSCredentialContext = {
  tts?: TTSSettings;
  audioTranscription?: Settings["audioTranscription"];
};

export interface ResolvedProviderKey {
  key: string;
  source?: { id: string; name: string; provider: string };
}

function getProviderConfig(settings: TTSCredentialContext | Settings, provider: string): Record<string, unknown> {
  const tts = "tts" in settings && settings.tts ? settings.tts : settings as unknown as TTSSettings;
  const providers = tts?.providers as Record<string, unknown> | undefined;
  const config = providers?.[provider];
  const result = config && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  // Accept settings objects created by older integrations while they are being
  // upgraded in memory. Persisted v3 settings use the provider-scoped key.
  if (!result.apiKey && (provider === "fal" || provider === "groq")) result.apiKey = tts.apiKey;
  return result;
}

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveAudioTranscriptionKey(settings: TTSCredentialContext | Settings): ResolvedProviderKey | null {
  const key = nonEmpty(settings.audioTranscription?.groq?.apiKey);
  return key ? { key, source: { id: "audio-transcription-groq", name: "Audio Transcription", provider: "groq" } } : null;
}

function resolveLLMProviderKey(): ResolvedProviderKey | null {
  const providers = useLLMProvidersStore.getState().providers;
  const candidates = providers.filter((provider) => provider.provider === "openrouter");
  const selected = candidates.find((provider) => provider.enabled && nonEmpty(provider.apiKey))
    || candidates.find((provider) => nonEmpty(provider.apiKey))
    || providers.find((provider) => nonEmpty(provider.apiKey));
  if (!selected) return null;
  const key = nonEmpty(selected.apiKey);
  if (!key) return null;
  return {
    key,
    source: {
      id: selected.id,
      name: selected.name || "OpenRouter provider",
      provider: selected.provider,
    },
  };
}

function borrowedKey(settings: TTSCredentialContext | Settings, auth: TTSAdapterAuth): ResolvedProviderKey | null {
  if (!auth.borrowFrom) return null;
  if (auth.borrowFrom.store === "audioTranscription") return resolveAudioTranscriptionKey(settings);
  return resolveLLMProviderKey();
}

/** Resolve credentials in the documented order: specific key, borrowed key, none. */
export function resolveProviderKey(
  adapter: Pick<TTSProviderAdapter, "id" | "auth">,
  settings: TTSCredentialContext | Settings,
): ResolvedProviderKey {
  if (adapter.auth.mode === "none") return { key: "" };
  const config = getProviderConfig(settings, adapter.id);
  const specific = nonEmpty(config.apiKey);
  if (specific) return { key: specific };
  return borrowedKey(settings, adapter.auth) || { key: "" };
}

/** Exposed for readiness indicators without making UI components know store details. */
export function getBorrowedProviderKey(settings: TTSCredentialContext | Settings, auth: TTSAdapterAuth): ResolvedProviderKey {
  return borrowedKey(settings, auth) || { key: "" };
}

export function describeBorrowedSource(source?: ResolvedProviderKey["source"]): string | undefined {
  if (!source) return undefined;
  return `${source.name} (${source.provider})`;
}

export type { LLMProviderConfig };
