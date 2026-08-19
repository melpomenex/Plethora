/**
 * Dictionary lookup service (spec: dictionary-peek "Cached and normalized
 * dictionary service"; change: unify-selection-dictionary-lookup, design D5).
 *
 * Providers stay online-only (dictionaryapi.dev for definitions/phonetics,
 * Datamuse for synonyms) with these hardening guarantees:
 *  - the query is normalized through the shared selection-intent resolver
 *    (`dictionaryQueryForText`) so `"ephemeral,"` never hits the wire;
 *  - provider phonetics / part-of-speech / examples are preserved (the legacy
 *    implementation discarded them);
 *  - failures are TYPED — `not-found` vs `unavailable` vs `offline-uncached` —
 *    so the UI can render explicit states instead of failing silently;
 *  - caching (React Query, `useDictionaryEntry`) makes repeat lookups
 *    offline-capable. First-time lookups require network — known limitation.
 */

import { dictionaryQueryForText } from "../components/viewer/selectionInteraction/intent";

export interface DictionarySense {
  partOfSpeech?: string;
  definition: string;
  example?: string;
}

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  audioUrl?: string;
  senses: DictionarySense[];
  synonyms: string[];
}

export type DictionaryFailure =
  | { kind: "not-found" }
  | { kind: "unavailable"; message?: string }
  | { kind: "offline-uncached" };

export type DictionaryEntryResult =
  | { ok: true; entry: DictionaryEntry }
  | { ok: false; failure: DictionaryFailure };

/** Shape of one dictionaryapi.dev entry (only the fields we consume). */
interface DictionaryApiEntry {
  word?: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string; audio?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
    synonyms?: string[];
  }>;
}

const MAX_SENSES = 6;
const MAX_SYNONYMS = 8;

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Parsed provider payload before synonym merging. */
interface FetchedEntry {
  entry: DictionaryEntry;
  /** dictionaryapi.dev per-meaning synonyms (merged with Datamuse later). */
  providerSynonyms: string[];
}

async function fetchEntry(query: string): Promise<FetchedEntry | "not-found" | "unavailable"> {
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`,
  );
  if (response.status === 404) return "not-found";
  if (!response.ok) return "unavailable";

  const data: unknown = await response.json();
  const entries: DictionaryApiEntry[] = Array.isArray(data) ? (data as DictionaryApiEntry[]) : [];

  let word = query;
  let phonetic: string | undefined;
  let audioUrl: string | undefined;
  const senses: DictionarySense[] = [];
  const providerSynonyms: string[] = [];

  for (const entry of entries) {
    if (word === query && typeof entry.word === "string" && entry.word.trim()) {
      word = entry.word.trim();
    }
    phonetic ||= typeof entry.phonetic === "string" && entry.phonetic.trim()
      ? entry.phonetic.trim()
      : undefined;
    audioUrl ||= entry.phonetics?.find((p) => typeof p.audio === "string" && p.audio.trim())
      ?.audio;

    for (const meaning of entry.meanings ?? []) {
      const partOfSpeech =
        typeof meaning.partOfSpeech === "string" && meaning.partOfSpeech.trim()
          ? meaning.partOfSpeech.trim()
          : undefined;
      for (const synonym of meaning.synonyms ?? []) {
        if (typeof synonym === "string" && synonym.trim()) providerSynonyms.push(synonym.trim());
      }
      for (const def of meaning.definitions ?? []) {
        const definition = typeof def.definition === "string" ? def.definition.trim() : "";
        if (!definition) continue;
        const example =
          typeof def.example === "string" && def.example.trim() ? def.example.trim() : undefined;
        senses.push(example ? { partOfSpeech, definition, example } : { partOfSpeech, definition });
      }
    }
  }

  if (senses.length === 0) return "not-found";

  const trimmedSenses = senses.slice(0, MAX_SENSES);
  const entry: DictionaryEntry = {
    word,
    ...(phonetic ? { phonetic } : {}),
    ...(audioUrl ? { audioUrl } : {}),
    senses: trimmedSenses,
    synonyms: [], // merged by the caller
  };
  return { entry, providerSynonyms };
}

async function fetchSynonyms(query: string): Promise<string[]> {
  const response = await fetch(`https://datamuse.com/words?ml=${encodeURIComponent(query)}&max=10`);
  if (!response.ok) return [];
  const data: unknown = await response.json();
  return (Array.isArray(data) ? data : [])
    .map((item: { word?: unknown }) => (typeof item?.word === "string" ? item.word.trim() : ""))
    .filter(Boolean);
}

/**
 * Look up a dictionary entry for a (possibly punctuated/cased) selection.
 * The query is normalized through the shared resolver before hitting the
 * network. Synonym lookup is best-effort: a Datamuse failure never fails the
 * definition.
 */
export async function lookupDictionaryEntry(rawQuery: string): Promise<DictionaryEntryResult> {
  const query = dictionaryQueryForText(rawQuery) || rawQuery.trim().toLowerCase();
  if (!query) return { ok: false, failure: { kind: "not-found" } };

  try {
    const [fetched, datamuseSynonyms] = await Promise.all([
      fetchEntry(query),
      fetchSynonyms(query).catch(() => [] as string[]),
    ]);
    if (fetched === "not-found") return { ok: false, failure: { kind: "not-found" } };
    if (fetched === "unavailable") {
      return { ok: false, failure: { kind: "unavailable", message: "Provider error" } };
    }

    const seen = new Set<string>([query]);
    const synonyms: string[] = [];
    for (const synonym of [...fetched.providerSynonyms, ...datamuseSynonyms]) {
      const key = synonym.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      synonyms.push(synonym);
      if (synonyms.length >= MAX_SYNONYMS) break;
    }

    return { ok: true, entry: { ...fetched.entry, synonyms } };
  } catch (error) {
    // Network-level failure (fetch threw): distinguish offline from provider
    // trouble so the peek can offer the right state.
    return {
      ok: false,
      failure: isOffline()
        ? { kind: "offline-uncached" }
        : {
            kind: "unavailable",
            message: error instanceof Error ? error.message : String(error),
          },
    };
  }
}

export interface DictionaryResult {
  word: string;
  definitions: string[];
  synonyms: string[];
}

export async function lookupDictionary(word: string): Promise<DictionaryResult> {
  const result = await lookupDictionaryEntry(word);
  if (result.ok) {
    return {
      word: result.entry.word,
      definitions: result.entry.senses.map((s) => s.definition),
      synonyms: result.entry.synonyms,
    };
  }
  const normalized = word.trim().toLowerCase();
  return { word: normalized || word, definitions: [], synonyms: [] };
}
