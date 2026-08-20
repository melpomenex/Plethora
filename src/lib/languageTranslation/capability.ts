import { canonicalizeLanguageTag } from "../languageProcessing/types";

export const LANGUAGE_TRANSLATION_CONTRACT_VERSION = "1.0.0" as const;
export const LANGUAGE_TRANSLATION_SCHEMA_VERSION = 1 as const;

/** Provider classes are ordered by the privacy-preserving selection policy. */
export type TranslationProviderKind = "local" | "dedicated" | "ai";

export const TRANSLATION_PROVIDER_PRIORITY: Readonly<Record<TranslationProviderKind, number>> = {
  local: 0,
  dedicated: 1,
  ai: 2,
};

export interface TranslationLanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationProviderCapabilities {
  /** True when the adapter implements sentence translation, not just generation. */
  sentenceTranslation: boolean;
  /** A pair list keeps unsupported language requests out of provider calls. */
  supportedLanguagePairs: readonly (TranslationLanguagePair | "*")[];
  /** The adapter can complete without network access. */
  offlineAvailable: boolean;
  /** True when sentence text is sent outside this device. */
  sendsTextOffDevice: boolean;
  /** Whether a configured credential or account is required. */
  requiresCredentials: boolean;
  /** Set false for an adapter that has not been configured yet. */
  configured: boolean;
  supportsCancellation: boolean;
  /** Optional model identity, included in cache keys and provenance. */
  model?: string;
  maxSentenceCodeUnits?: number;
  /** User-facing explanation of the provider's data flow. */
  privacyDisclosure: string;
}

function normalizedLanguageTag(value: string): string | null {
  const canonical = canonicalizeLanguageTag(value);
  return canonical ? String(canonical).toLowerCase() : null;
}

function languageMatches(actual: string, supported: string): boolean {
  return actual === supported || actual.startsWith(`${supported}-`);
}

export function supportsTranslationLanguagePair(
  capabilities: TranslationProviderCapabilities,
  sourceLanguage: string,
  targetLanguage: string,
): boolean {
  if (!capabilities.sentenceTranslation) return false;
  const source = normalizedLanguageTag(sourceLanguage);
  const target = normalizedLanguageTag(targetLanguage);
  if (!source || !target) return false;

  return capabilities.supportedLanguagePairs.some((pair) => {
    if (pair === "*") return true;
    const supportedSource = normalizedLanguageTag(pair.sourceLanguage);
    const supportedTarget = normalizedLanguageTag(pair.targetLanguage);
    return Boolean(
      supportedSource &&
        supportedTarget &&
        languageMatches(source, supportedSource) &&
        languageMatches(target, supportedTarget),
    );
  });
}
