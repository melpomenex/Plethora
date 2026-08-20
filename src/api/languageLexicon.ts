import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  EncounterBatchResult,
  EncounterInput,
  LanguageLexicalEntry,
  LanguageLookupEvent,
  LanguageOccurrence,
  LanguageLexiconExport,
  LegacyLookupRecord,
  LexicalEntryOverride,
  LexiconPage,
  LookupInput,
} from "../types/languageLexicon";

type LexiconCall = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: LexiconCall = (command, args) =>
  isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

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
