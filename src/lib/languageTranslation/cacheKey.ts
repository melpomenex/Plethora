import { canonicalStableJson, contentFingerprint, digestConfiguration, digestText128 } from "../languageProcessing/fingerprints";
import type { SourceAnchor } from "../languageProcessing/types";
import {
  LANGUAGE_TRANSLATION_CONTRACT_VERSION,
  LANGUAGE_TRANSLATION_SCHEMA_VERSION,
} from "./capability";

export type TranslationCacheKey = string & { readonly __translationCacheKey: "TranslationCacheKey" };

export interface TranslationCacheIdentity {
  contractVersion: string;
  schemaVersion: number;
  sourceFingerprint: string;
  sourceAnchorFingerprint: string;
  profileId: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerVersion: string;
  model?: string;
  configurationFingerprint: string;
}

export interface TranslationCacheKeyInput {
  text: string;
  sourceFingerprint?: string;
  sourceAnchor?: SourceAnchor;
  profileId: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerVersion: string;
  model?: string;
  configuration?: Readonly<Record<string, unknown>>;
}

export function translationCacheIdentity(input: TranslationCacheKeyInput): TranslationCacheIdentity {
  return {
    contractVersion: LANGUAGE_TRANSLATION_CONTRACT_VERSION,
    schemaVersion: LANGUAGE_TRANSLATION_SCHEMA_VERSION,
    // Exact source text is fingerprinted; normalization is never used for invalidation.
    sourceFingerprint: input.sourceFingerprint ?? contentFingerprint(input.text),
    sourceAnchorFingerprint: digestText128(canonicalStableJson(input.sourceAnchor ?? null)),
    profileId: input.profileId,
    sourceLanguage: input.sourceLanguage.toLowerCase(),
    targetLanguage: input.targetLanguage.toLowerCase(),
    providerId: input.providerId,
    providerVersion: input.providerVersion,
    model: input.model,
    configurationFingerprint: digestConfiguration(input.configuration ?? {}),
  };
}

export function createTranslationCacheKey(identity: TranslationCacheIdentity): TranslationCacheKey {
  return [
    `translation-contract=${identity.contractVersion}`,
    `schema=${identity.schemaVersion}`,
    `source=${identity.sourceFingerprint}`,
    `anchor=${identity.sourceAnchorFingerprint}`,
    `profile=${identity.profileId}`,
    `source-language=${identity.sourceLanguage}`,
    `target-language=${identity.targetLanguage}`,
    `provider=${identity.providerId}`,
    `version=${identity.providerVersion}`,
    `model=${identity.model ?? "default"}`,
    `config=${identity.configurationFingerprint}`,
  ].join("|") as TranslationCacheKey;
}
