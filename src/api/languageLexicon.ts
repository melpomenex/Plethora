import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  EncounterBatchResult,
  EncounterInput,
  LanguageLexicalEntry,
  LanguageLookupEvent,
  LanguageOccurrence,
  LanguageSurfaceForm,
  LanguageLexiconExport,
  LegacyLookupRecord,
  LexicalEntryOverride,
  LexiconPage,
  LookupInput,
  LexicalObjectKind,
} from "../types/languageLexicon";

type LexiconCall = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: LexiconCall = (command, args) =>
  isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

export interface LexicalEntryUpsertInput {
  id?: string;
  profileId: string;
  languageTag: string;
  normalizedForm: string;
  canonicalForm?: string;
  lemma?: string;
  objectKind?: LexicalObjectKind;
  meanings?: string[];
  translations?: string[];
  partOfSpeech?: string;
  pronunciation?: string;
  frequency?: number;
  cefrLevel?: string;
  providerId?: string;
  providerVersion?: string;
  processorId?: string;
  processorVersion?: string;
  identityConfidence?: number;
}

export interface LexicalEntrySearchFilter {
  profileId: string;
  query?: string;
  languageTag?: string;
  knowledgeState?: string;
  objectKind?: LexicalObjectKind;
  ignored?: boolean;
  lemma?: string;
  offset?: number;
  limit?: number;
}

export function upsertLanguageLexicalEntry(input: LexicalEntryUpsertInput) {
  return call<LanguageLexicalEntry>("upsert_language_lexical_entry", { input });
}

export function getLanguageLexicalEntry(profileId: string, entryId: string) {
  return call<LanguageLexicalEntry | null>("get_language_lexical_entry", { profileId, entryId });
}

export function listLanguageLexicalEntries(
  profileId: string,
  options: { languageTag?: string; offset?: number; limit?: number } = {},
) {
  return call<LexiconPage<LanguageLexicalEntry>>("list_language_lexical_entries", {
    profileId,
    languageTag: options.languageTag,
    offset: options.offset ?? 0,
    limit: options.limit ?? 50,
  });
}

export function searchLanguageLexicalEntries(filter: LexicalEntrySearchFilter) {
  return call<LexiconPage<LanguageLexicalEntry>>("search_language_lexical_entries", {
    filter: {
      offset: 0,
      limit: 50,
      ...filter,
    },
  });
}

export function deleteLanguageLexicalEntry(profileId: string, entryId: string) {
  return call<boolean>("delete_language_lexical_entry", { profileId, entryId });
}

export function deleteLanguageOccurrence(profileId: string, occurrenceId: string) {
  return call<boolean>("delete_language_occurrence", { profileId, occurrenceId });
}

export function purgeExpiredLanguageOccurrences(profileId: string, now = Math.floor(Date.now() / 1000)) {
  const normalizedNow = now > 10_000_000_000 ? Math.floor(now / 1000) : now;
  return call<number>("purge_expired_language_occurrences", { profileId, now: normalizedNow });
}

export function listLanguageSurfaceForms(
  profileId: string,
  options: { entryId?: string; offset?: number; limit?: number } = {},
) {
  return call<LexiconPage<LanguageSurfaceForm>>("list_language_surface_forms", {
    profileId,
    entryId: options.entryId,
    offset: options.offset ?? 0,
    limit: options.limit ?? 50,
  });
}

export function listLanguageLookupEvents(
  profileId: string,
  options: { offset?: number; limit?: number } = {},
) {
  return call<LexiconPage<LanguageLookupEvent>>("list_language_lookup_events", {
    profileId,
    offset: options.offset ?? 0,
    limit: options.limit ?? 50,
  });
}

export function importLanguageLexicon(profileId: string, entries: LanguageLexicalEntry[]) {
  return call<number>("import_language_lexicon", { profileId, entries });
}

export function recordLanguageEncounter(input: EncounterInput) {
  return call<LanguageLexicalEntry>("record_language_encounter", { input });
}

export function recordLanguageEncounterBatch(inputs: EncounterInput[]) {
  return call<EncounterBatchResult>("record_language_encounter_batch", { inputs });
}

export function listLanguageOccurrences(
  profileId: string,
  options: {
    entryId?: string;
    documentId?: string;
    mediaId?: string;
    languageTag?: string;
    offset?: number;
    limit?: number;
  } = {},
) {
  return call<LexiconPage<LanguageOccurrence>>("list_language_occurrences", {
    profileId,
    ...options,
    offset: options.offset ?? 0,
    limit: options.limit ?? 50,
  });
}

export function recordLanguageLookup(input: LookupInput) {
  return call<LanguageLookupEvent>("record_language_lookup", { input });
}

export function migrateLanguageLookupHistory(profileId: string, records: LegacyLookupRecord[]) {
  return call<number>("migrate_language_lookup_history", { profileId, records });
}

export function applyLanguageLexicalOverride(input: LexicalEntryOverride) {
  return call<LanguageLexicalEntry>("apply_language_lexical_override", { input });
}

export function exportLanguageLexicon(
  profileId: string,
  options: { includeOccurrences?: boolean; occurrenceOffset?: number; occurrenceLimit?: number } = {},
) {
  return call<LanguageLexiconExport>("export_language_lexicon", {
    profileId,
    includeOccurrences: options.includeOccurrences ?? false,
    occurrenceOffset: options.occurrenceOffset ?? 0,
    occurrenceLimit: options.occurrenceLimit ?? 50,
  });
}

export function serializeLanguageLexiconForSync(profileId: string) {
  return call("serialize_language_lexicon_for_sync", { profileId });
}
