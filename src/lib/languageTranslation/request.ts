import type { SourceAnchor } from "../languageProcessing/types";
import { canonicalizeLanguageTag } from "../languageProcessing/types";
import type { TranslationProviderPolicy } from "./settings";

export interface TranslationRequest {
  /** Exact sentence text. It is never normalized before being sent or stored. */
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  profileId: string;
  sourceAnchor?: SourceAnchor;
  /** Fingerprint of the canonical source document, when the reader has one. */
  sourceFingerprint?: string;
  /** Alias accepted at the boundary used by the processing contract. */
  contentFingerprint?: string;
  /** Configuration that changes translation output, such as prompt version. */
  configuration?: Readonly<Record<string, unknown>>;
  providerPolicy?: Partial<TranslationProviderPolicy>;
}

export interface CanonicalTranslationRequest extends Omit<TranslationRequest, "sourceLanguage" | "targetLanguage" | "providerPolicy"> {
  sourceLanguage: string;
  targetLanguage: string;
  providerPolicy: TranslationProviderPolicy;
  sourceFingerprint?: string;
}

export function canonicalizeTranslationLanguageTag(value: string): string | null {
  const canonical = canonicalizeLanguageTag(value);
  return canonical ? String(canonical) : null;
}
