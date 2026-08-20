import type { SourceAnchor } from "../languageProcessing/types";
import type { TranslationCacheKey } from "./cacheKey";
import type { TranslationProviderKind } from "./capability";
import type { TranslationProvenance } from "./provenance";

export interface TranslationResult {
  /** The original sentence, retained for source-preserving rendering. */
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  profileId: string;
  sourceFingerprint: string;
  sourceAnchor?: SourceAnchor;
  providerId: string;
  providerKind: TranslationProviderKind;
  providerVersion: string;
  model?: string;
  confidence?: number | null;
  cacheKey: TranslationCacheKey;
  provenance: TranslationProvenance;
  /** True only for a response read from the cache, never for a provider call. */
  fromCache: boolean;
}

export type StoredTranslationResult = Omit<TranslationResult, "fromCache">;
