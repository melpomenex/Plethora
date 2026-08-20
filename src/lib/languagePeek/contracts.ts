import type { DictionaryEntry, DictionaryFailure, DictionaryEntryResult } from "../../utils/dictionaryLookup";
import type { SourceAnchor } from "../../types/languageLexicon";

export interface PeekAnalysisContext {
  lemma?: string;
  partOfSpeech?: string;
  morphology?: Record<string, unknown>;
  confidence?: number;
  processingKey?: string;
}

export interface PeekPhraseContext {
  phraseId?: string;
  normalizedForm: string;
  translation?: string;
  meaning?: string;
}

export interface PeekSentenceContext {
  sentenceId?: string;
  text: string;
  translation?: string;
  sourceAnchor?: SourceAnchor;
}

export interface LanguagePeekTargetContext {
  profileId?: string;
  languageTag?: string;
  analysis?: PeekAnalysisContext;
  phrase?: PeekPhraseContext;
  sentence?: PeekSentenceContext;
  sourceAnchor?: SourceAnchor;
}

export type LanguagePeekFailure = DictionaryFailure | { kind: "unsupported-language" } | { kind: "cancelled" };

export interface LanguagePeekProviderResult {
  providerId: string;
  providerVersion?: string;
  dictionary?: DictionaryEntry;
  analysis?: PeekAnalysisContext;
  translation?: string;
  provenance: "local" | "dedicated" | "ai";
}

export type LanguagePeekLookupResult =
  | { ok: true; result: LanguagePeekProviderResult }
  | { ok: false; failure: LanguagePeekFailure };

export interface LanguagePeekProvider {
  id: string;
  version?: string;
  supports(languageTag: string | undefined): boolean;
  lookup(input: {
    text: string;
    languageTag?: string;
    context?: LanguagePeekTargetContext;
    signal?: AbortSignal;
  }): Promise<LanguagePeekLookupResult>;
}

export interface LanguagePeekCacheKeyInput {
  text: string;
  profileId?: string;
  languageTag?: string;
  analysisKey?: string;
  phraseId?: string;
  providerId?: string;
  providerVersion?: string;
}

export function createLanguagePeekCacheKey(input: LanguagePeekCacheKeyInput): string {
  return [
    input.profileId ?? "-",
    input.languageTag ?? "-",
    input.text.trim().toLocaleLowerCase(),
    input.analysisKey ?? "-",
    input.phraseId ?? "-",
    input.providerId ?? "-",
    input.providerVersion ?? "-",
  ].join("\u001f");
}

export function isLanguagePeekFailure(result: LanguagePeekLookupResult): result is Extract<LanguagePeekLookupResult, { ok: false }> {
  return !result.ok;
}
