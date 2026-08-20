import type {
  LanguageHighlightSettings,
  LanguageHighlightTheme,
  VocabularyAnnotationMode,
} from "./types";

export const LANGUAGE_HIGHLIGHT_SETTINGS_VERSION = 1;
export const LANGUAGE_HIGHLIGHT_SETTINGS_KEY_PREFIX = "plethora:language-highlighting:";

export interface LanguageHighlightStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function languageHighlightSettingsKey(profileId: string): string {
  return `${LANGUAGE_HIGHLIGHT_SETTINGS_KEY_PREFIX}${encodeURIComponent(profileId)}`;
}

export function defaultLanguageHighlightSettings(profileId: string): LanguageHighlightSettings {
  return {
    profileId,
    // Language Mode is opt-in. Ordinary reading remains unchanged until a profile enables it.
    mode: "off",
    theme: "light",
    highContrast: false,
    reducedMotion: false,
    eInk: false,
    announceState: false,
  };
}

function isMode(value: unknown): value is VocabularyAnnotationMode {
  return value === "off" || value === "minimal" || value === "full";
}

function isTheme(value: unknown): value is LanguageHighlightTheme {
  return value === "light" || value === "dark" || value === "high-contrast" || value === "e-ink";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeLanguageHighlightSettings(
  profileId: string,
  input: Partial<LanguageHighlightSettings> | null | undefined,
): LanguageHighlightSettings {
  const defaults = defaultLanguageHighlightSettings(profileId);
  return {
    ...defaults,
    ...input,
    profileId,
    mode: isMode(input?.mode) ? input.mode : defaults.mode,
    theme: isTheme(input?.theme) ? input.theme : defaults.theme,
    highContrast: input?.highContrast === true,
    reducedMotion: input?.reducedMotion === true,
    eInk: input?.eInk === true,
    announceState: input?.announceState === true,
  };
}

export function loadLanguageHighlightSettings(
  profileId: string,
  storage: LanguageHighlightStorage | null | undefined,
): LanguageHighlightSettings {
  const defaults = defaultLanguageHighlightSettings(profileId);
  if (!storage) return defaults;
  try {
    const raw = storage.getItem(languageHighlightSettingsKey(profileId));
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== LANGUAGE_HIGHLIGHT_SETTINGS_VERSION) {
      return defaults;
    }
    return normalizeLanguageHighlightSettings(profileId, parsed.settings as Partial<LanguageHighlightSettings>);
  } catch {
    // Settings must never prevent a reader from opening.
    return defaults;
  }
}

export function saveLanguageHighlightSettings(
  settings: LanguageHighlightSettings,
  storage: LanguageHighlightStorage | null | undefined,
): boolean {
  if (!storage) return false;
  try {
    const normalized = normalizeLanguageHighlightSettings(settings.profileId, settings);
    storage.setItem(
      languageHighlightSettingsKey(settings.profileId),
      JSON.stringify({ version: LANGUAGE_HIGHLIGHT_SETTINGS_VERSION, settings: normalized }),
    );
    return true;
  } catch {
    // A private-mode or unavailable storage backend is not a reader blocker.
    return false;
  }
}
