/**
 * Assistant provider persistence — the single source of truth for remembering
 * the user's chosen LLM provider across reloads and view changes.
 *
 * Previously each surface (AssistantPanel, QueueScrollPage, PwaAssistantButton)
 * re-implemented this localStorage logic by hand, with subtly divergent
 * validation (e.g. PwaAssistantButton forgot `deepseek`). Centralizing here
 * keeps read/write/fallback uniform and unit-testable.
 */

export const ASSISTANT_PROVIDER_STORAGE_KEY = "assistant-llm-provider";

export type AssistantProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "ollama"
  | "openrouter"
  | "ondevice-apple-foundation";

export const APPLE_FM_ASSISTANT_PROVIDER = "ondevice-apple-foundation" as const;

const VALID_PROVIDERS: readonly string[] = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "ollama",
  "openrouter",
  APPLE_FM_ASSISTANT_PROVIDER,
];

export function isAppleFmAssistantProvider(id: AssistantProviderId): boolean {
  return id === APPLE_FM_ASSISTANT_PROVIDER;
}

export function isAssistantProviderId(value: unknown): value is AssistantProviderId {
  return typeof value === "string" && VALID_PROVIDERS.includes(value);
}

/**
 * Read the persisted provider, falling back to `fallback` (default "openai")
 * when nothing is stored or the stored value isn't a known provider id.
 * Storage access is guarded: an unavailable/blocked localStorage must not
 * crash the assistant panel.
 */
export function getStoredAssistantProvider(fallback: AssistantProviderId = "openai"): AssistantProviderId {
  try {
    const stored = localStorage.getItem(ASSISTANT_PROVIDER_STORAGE_KEY);
    return isAssistantProviderId(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Persist the chosen provider. Best-effort: if storage is unavailable
 * (private mode, sandboxed webview), the in-memory selection still applies
 * for the current session and the failure is silently swallowed.
 */
export function persistAssistantProvider(provider: AssistantProviderId): void {
  try {
    localStorage.setItem(ASSISTANT_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // Storage may be unavailable — ignore; the selection still holds for this
    // session via component state.
  }
}
