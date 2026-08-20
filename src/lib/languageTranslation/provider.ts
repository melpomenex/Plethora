import type { TranslationCacheKey } from "./cacheKey";
import type { TranslationProviderCapabilities, TranslationProviderKind } from "./capability";
import type { CanonicalTranslationRequest } from "./request";

export interface TranslationProviderRequest
  extends Pick<CanonicalTranslationRequest, "text" | "sourceLanguage" | "targetLanguage" | "profileId" | "sourceAnchor" | "sourceFingerprint"> {
  cacheKey: TranslationCacheKey;
}

export interface TranslationProviderResponse {
  translatedText: string;
  confidence?: number | null;
}

export interface TranslationProviderCallOptions {
  signal?: AbortSignal;
}

/** Adapter boundary; providers never own caching, retries, or privacy policy. */
export interface TranslationProvider {
  readonly id: string;
  readonly kind: TranslationProviderKind;
  readonly version: string;
  readonly capabilities: TranslationProviderCapabilities;
  translate(
    request: TranslationProviderRequest,
    options?: TranslationProviderCallOptions,
  ): Promise<TranslationProviderResponse>;
}
