import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";

export interface LanguagePhraseRecord {
  id: string;
  profileId: string;
  languageTag: string;
  phraseKey: string;
  normalizedForm: string;
  canonicalForm: string;
  meaning?: string;
  translation?: string;
  confidence?: number;
  state: string;
  firstEncounteredAt?: number;
  lastEncounteredAt?: number;
  occurrenceCount: number;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface LanguageSrsDraftRecord {
  id: string;
  profileId: string;
  lexicalEntryId?: string;
  phraseId?: string;
  sentenceId?: string;
  draftKey: string;
  itemType: string;
  question: string;
  answer?: string;
  sourceAnchor?: unknown;
  provenance: Record<string, unknown>;
  providerId?: string;
  providerVersion?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface LanguageAudioAlignmentRecord {
  id: string;
  profileId?: string;
  sourceType: string;
  sourceId: string;
  sentenceId: string;
  mediaId: string;
  sourceFingerprint: string;
  mediaFingerprint: string;
  startMs: number;
  endMs: number;
  confidence: number;
  method: string;
  status: "ready" | "stale" | "ambiguous" | "failed";
  providerId?: string;
  providerVersion?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LanguageCoverageResultRecord {
  coverageKey: string;
  documentId: string;
  profileId: string;
  contentFingerprint: string;
  processorVersion: string;
  lexiconStateVersion: string;
  policyVersion: string;
  thresholdVersion: string;
  method: string;
  freshness: "pending" | "fresh" | "stale" | "unavailable" | "failed";
  summary?: Record<string, unknown>;
  uniqueVocab?: Record<string, unknown>;
  error?: string;
  computedAt?: number;
  updatedAt: number;
}

export interface LanguageRecommendationCandidateRecord {
  id: string;
  profileId: string;
  sourceType: string;
  sourceId: string;
  sourceFingerprint: string;
  title: string;
  url?: string;
  explanation: Record<string, unknown>;
  ranking: Record<string, unknown>;
  coverageStatus: "pending" | "fresh" | "stale" | "unavailable";
  lifecycle: "candidate" | "accepted" | "dismissed" | "snoozed" | "expired";
  snoozedUntil?: number;
  createdAt: number;
  updatedAt: number;
}

export interface LanguageAnalyticsDailyRecord {
  profileId: string;
  dayUtc: string;
  metrics: Record<string, number>;
  eventCursor: number;
  updatedAt: number;
}

export interface LanguageGeneratedDocumentRecord {
  id: string;
  profileId: string;
  documentId?: string;
  sourceDocumentId?: string;
  actionKind: string;
  targetCoverage?: number;
  measuredCoverage?: number;
  providerId?: string;
  modelId?: string;
  promptSummary?: string;
  provenance: Record<string, unknown>;
  createdAt: number;
}

export interface LanguageTranslationCacheRecord {
  cacheKey: string;
  profileId?: string;
  sourceLang: string;
  targetLang: string;
  sourceHash: string;
  providerId: string;
  providerVersion: string;
  translationText: string;
  confidence?: number;
  createdAt: number;
  expiresAt?: number;
}

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: Call = (command, args) =>
  isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

export function upsertLanguagePhrase(phrase: Partial<LanguagePhraseRecord> & { profileId: string; languageTag: string; canonicalForm: string }) {
  return call<LanguagePhraseRecord>("upsert_language_phrase", { phrase });
}

export function listLanguagePhrases(profileId: string, options: { languageTag?: string; limit?: number } = {}) {
  return call<LanguagePhraseRecord[]>("list_language_phrases", { profileId, ...options });
}

export function deleteLanguagePhrase(profileId: string, phraseId: string) {
  return call<boolean>("delete_language_phrase", { profileId, phraseId });
}

export function upsertLanguageSrsDraft(draft: Partial<LanguageSrsDraftRecord> & { profileId: string; draftKey: string; question: string }) {
  return call<LanguageSrsDraftRecord>("upsert_language_srs_draft", { draft });
}

export function findLanguageSrsDraftByKey(profileId: string, draftKey: string) {
  return call<LanguageSrsDraftRecord | null>("find_language_srs_draft_by_key", { profileId, draftKey });
}

export function upsertLanguageAudioAlignment(alignment: LanguageAudioAlignmentRecord) {
  return call<LanguageAudioAlignmentRecord>("upsert_language_audio_alignment", { alignment });
}

export function listLanguageAudioAlignments(sourceId: string, profileId?: string) {
  return call<LanguageAudioAlignmentRecord[]>("list_language_audio_alignments", { sourceId, profileId });
}

export function upsertLanguageCoverageResult(record: LanguageCoverageResultRecord, referencedEntryIds: string[] = []) {
  return call<LanguageCoverageResultRecord>("upsert_language_coverage_result", { record, referencedEntryIds });
}

export function getLanguageCoverageResults(profileId: string, documentId?: string) {
  return call<LanguageCoverageResultRecord[]>("get_language_coverage_results", { profileId, documentId });
}

export function invalidateLanguageCoverageForEntry(profileId: string, lexicalEntryId: string) {
  return call<number>("invalidate_language_coverage_for_entry", { profileId, lexicalEntryId });
}

export function upsertLanguageRecommendationCandidate(candidate: LanguageRecommendationCandidateRecord) {
  return call<LanguageRecommendationCandidateRecord>("upsert_language_recommendation_candidate", { candidate });
}

export function listLanguageRecommendationCandidates(profileId: string, lifecycle?: string) {
  return call<LanguageRecommendationCandidateRecord[]>("list_language_recommendation_candidates", { profileId, lifecycle });
}

export function recordLanguageAnalyticsEvent(input: {
  idempotencyKey: string;
  profileId: string;
  eventKind: string;
  payload?: Record<string, unknown>;
  occurredAt?: number;
}) {
  return call<boolean>("record_language_analytics_event", { input });
}

export function listLanguageAnalyticsDaily(profileId: string, options: { startDay?: string; endDay?: string } = {}) {
  return call<LanguageAnalyticsDailyRecord[]>("list_language_analytics_daily", { profileId, ...options });
}

export function recordLanguageGeneratedDocument(record: Partial<LanguageGeneratedDocumentRecord> & { profileId: string; actionKind: string }) {
  return call<LanguageGeneratedDocumentRecord>("record_language_generated_document", { record });
}

export function listLanguageGeneratedDocuments(profileId: string) {
  return call<LanguageGeneratedDocumentRecord[]>("list_language_generated_documents", { profileId });
}

export function putLanguageTranslationCache(record: LanguageTranslationCacheRecord) {
  return call<LanguageTranslationCacheRecord>("put_language_translation_cache", { record });
}

export function getLanguageTranslationCache(cacheKey: string) {
  return call<LanguageTranslationCacheRecord | null>("get_language_translation_cache", { cacheKey });
}
