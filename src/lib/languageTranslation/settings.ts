export type TranslationPrivacyMode = "local-only" | "allow-cloud";

/** Runtime policy; a request may override these values explicitly. */
export interface TranslationProviderPolicy {
  offline: boolean;
  privacy: TranslationPrivacyMode;
  preferredProviderId?: string;
}

export interface TranslationSettings extends TranslationProviderPolicy {
  maxRetries: number;
  retryDelayMs: number;
}

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  // Cloud use is opt-in. Local providers can still be selected while online.
  offline: false,
  privacy: "local-only",
  maxRetries: 1,
  retryDelayMs: 250,
};

export function resolveTranslationSettings(
  settings: Partial<TranslationSettings> = {},
): TranslationSettings {
  return {
    offline: settings.offline ?? DEFAULT_TRANSLATION_SETTINGS.offline,
    privacy: settings.privacy ?? DEFAULT_TRANSLATION_SETTINGS.privacy,
    preferredProviderId: settings.preferredProviderId,
    maxRetries: Math.max(0, Math.floor(settings.maxRetries ?? DEFAULT_TRANSLATION_SETTINGS.maxRetries)),
    retryDelayMs: Math.max(0, settings.retryDelayMs ?? DEFAULT_TRANSLATION_SETTINGS.retryDelayMs),
  };
}

export function resolveTranslationPolicy(
  settings: TranslationProviderPolicy,
  override: Partial<TranslationProviderPolicy> = {},
): TranslationProviderPolicy {
  return {
    offline: override.offline ?? settings.offline,
    privacy: override.privacy ?? settings.privacy,
    preferredProviderId: override.preferredProviderId ?? settings.preferredProviderId,
  };
}
