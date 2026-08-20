import type { SourceAnchor } from "../languageProcessing/types";
import type { TranslationCacheKey } from "./cacheKey";
import type { TranslationProviderKind } from "./capability";

export interface TranslationPrivacyDisclosure {
  dataLeavesDevice: boolean;
  description: string;
}

export interface TranslationProvenance {
  sourceFingerprint: string;
  sourceAnchor?: SourceAnchor;
  profileId: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerKind: TranslationProviderKind;
  providerVersion: string;
  model?: string;
  cacheKey: TranslationCacheKey;
  generatedAt: number;
  confidence?: number | null;
  privacy: TranslationPrivacyDisclosure;
}
