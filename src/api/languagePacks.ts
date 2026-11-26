import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";

export interface LanguagePackRecord {
  id: string;
  languageTag: string;
  targetLanguage: string;
  baseLanguage?: string;
  name: string;
  kind: "dictionary" | "morphology" | "readings" | "frequency" | "bundle";
  format: "json" | "tsv" | "yomichan-zip" | "stardict" | "kaikki-jsonl";
  version: string;
  sourceUrl?: string;
  sha256: string;
  sizeBytes: number;
  entryCount: number;
  license: string;
  attribution: string;
  capabilities: Record<string, unknown>;
  installPath?: string;
  status: "installed" | "corrupt" | "removed";
  error?: string;
  installedAt: number;
  updatedAt: number;
  lastVerifiedAt?: number;
}

export interface LanguageDictionaryEntryRecord {
  id: string;
  packId: string;
  languageTag: string;
  headword: string;
  normalizedHeadword: string;
  reading?: string;
  lemma?: string;
  partOfSpeech?: string;
  morphology: Record<string, unknown>;
  senses: Array<{ definition: string; glosses?: string[]; tags?: string[] }>;
  examples: string[];
  frequencyRank?: number;
}

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: Call = (command, args) =>
  isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

export function listLanguagePacks(languageTag?: string) {
  return call<LanguagePackRecord[]>("list_language_packs", { languageTag });
}

export function installLanguagePackWithEntries(
  pack: LanguagePackRecord,
  entries: LanguageDictionaryEntryRecord[],
) {
  return call<LanguagePackRecord>("install_language_pack_with_entries", { pack, entries });
}

export function lookupLanguagePackDictionary(
  languageTag: string,
  query: string,
  options: { lemma?: string; limit?: number } = {},
) {
  return call<LanguageDictionaryEntryRecord[]>("lookup_language_pack_dictionary", {
    languageTag,
    query,
    lemma: options.lemma,
    limit: options.limit ?? 20,
  });
}

export function verifyLanguagePack(packId: string) {
  return call<LanguagePackRecord>("verify_language_pack", { packId });
}

export function removeLanguagePack(packId: string) {
  return call<boolean>("remove_language_pack", { packId });
}
