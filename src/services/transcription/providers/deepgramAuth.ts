import type { Settings } from "../../../stores/settingsStore";

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Resolve Deepgram API key from user settings (BYOK). Dev-only env fallback. */
export function resolveDeepgramApiKey(settings: Settings): string {
  const fromSettings = nonEmpty(settings.audioTranscription.deepgram?.apiKey);
  if (fromSettings) return fromSettings;
  if (import.meta.env.DEV) {
    return nonEmpty(import.meta.env.VITE_DEEPGRAM_API_KEY);
  }
  return "";
}
