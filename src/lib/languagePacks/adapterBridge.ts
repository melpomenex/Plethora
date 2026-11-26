import { lookupLanguagePackDictionary } from "../../api/languagePacks";
import {
  getLanguageAdapterPackResolver,
  setLanguageAdapterPackResolver,
  type LanguageAdapterPackResolver,
  type PackLexiconEntry,
  type PackSegment,
} from "../languageProcessing/adapters/shared";
import { canonicalizeLanguageTag, normalizeForLookup } from "../languageProcessing";
import { getStarterPackEntries, LANGUAGE_PACK_CATALOG } from "./catalog";
import type { ParsedDictionaryEntry } from "./types";

const MAX_CACHE_ENTRIES = 2_000;
const entryCache = new Map<string, PackLexiconEntry | null>();
let starterIndex: Map<string, Map<string, ParsedDictionaryEntry>> | null = null;
let installedBridge = false;

function buildStarterIndex(): Map<string, Map<string, ParsedDictionaryEntry>> {
  if (starterIndex) return starterIndex;
  const byLanguage = new Map<string, Map<string, ParsedDictionaryEntry>>();
  for (const item of LANGUAGE_PACK_CATALOG) {
    if (item.availability !== "embedded-starter") continue;
    const entries = getStarterPackEntries(item.id);
    if (!entries?.length) continue;
    const langKey = canonicalizeLanguageTag(item.targetLanguage).toLowerCase().split("-")[0] ?? "";
    const map = byLanguage.get(langKey) ?? new Map<string, ParsedDictionaryEntry>();
    for (const entry of entries) {
      const norm = entry.normalizedHeadword || normalizeForLookup(entry.headword, langKey);
      if (norm && !map.has(norm)) map.set(norm, entry);
      if (entry.headword && !map.has(entry.headword)) map.set(entry.headword, entry);
    }
    byLanguage.set(langKey, map);
  }
  starterIndex = byLanguage;
  return byLanguage;
}

function cacheSet(key: string, value: PackLexiconEntry | null): void {
  if (entryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = entryCache.keys().next().value;
    if (oldest !== undefined) entryCache.delete(oldest);
  }
  entryCache.set(key, value);
}

function toPackLexiconEntry(entry: {
  lemma?: string;
  partOfSpeech?: string;
  pos?: string;
  reading?: string;
  morphology?: Record<string, unknown>;
  confidence?: number;
}): PackLexiconEntry {
  const morph: Record<string, string> = {};
  if (entry.morphology) {
    for (const [key, value] of Object.entries(entry.morphology)) {
      if (typeof value === "string") morph[key] = value;
    }
  }
  const compoundParts = Array.isArray(entry.morphology?.compoundParts)
    ? entry.morphology!.compoundParts.filter((part): part is string => typeof part === "string")
    : undefined;
  return {
    lemma: entry.lemma,
    pos: entry.partOfSpeech ?? entry.pos,
    reading: entry.reading,
    morphology: Object.keys(morph).length > 0 ? morph : undefined,
    compoundParts,
    confidence: 0.94,
  };
}

/**
 * Connects installed SQLite Language Packs (and embedded starter packs as a
 * zero-setup fallback) into `setLanguageAdapterPackResolver` so local CJK,
 * Korean, Romance, Germanic, and RTL adapters automatically leverage user packs.
 */
export function createLanguageAdapterPackResolver(): LanguageAdapterPackResolver {
  const starters = buildStarterIndex();
  return {
    lookupToken: async (surface, normalized, languageTag) => {
      const langBase = canonicalizeLanguageTag(languageTag).toLowerCase().split("-")[0] ?? "";
      const normKey = normalized || normalizeForLookup(surface, languageTag);
      const cacheKey = `${langBase}\u001f${normKey}`;
      if (entryCache.has(cacheKey)) return entryCache.get(cacheKey) ?? null;

      try {
        const dbMatches = await lookupLanguagePackDictionary(languageTag, surface, {
          lemma: normKey,
          limit: 5,
        });
        const best = dbMatches.find(
          (row) => row.normalizedHeadword === normKey || row.headword === surface,
        ) ?? dbMatches[0];
        if (best) {
          const adapted = toPackLexiconEntry(best);
          cacheSet(cacheKey, adapted);
          return adapted;
        }
      } catch {
        // Fallback cleanly to embedded starters or heuristics.
      }

      const starterMap = starters.get(langBase);
      const starterHit = starterMap?.get(normKey) ?? starterMap?.get(surface);
      const adapted = starterHit
        ? toPackLexiconEntry({
            lemma: starterHit.lemma,
            pos: starterHit.pos,
            reading: starterHit.reading,
            morphology: starterHit.morphology,
          })
        : null;
      cacheSet(cacheKey, adapted);
      return adapted;
    },
    segmentText: (text, languageTag): readonly PackSegment[] | null => {
      const langBase = canonicalizeLanguageTag(languageTag).toLowerCase().split("-")[0] ?? "";
      if (langBase !== "ja" && langBase !== "zh") return null;
      const starterMap = starters.get(langBase);
      if (!starterMap || starterMap.size === 0 || !text) return null;
      // Forward longest-match enhancement using installed starter multi-char headwords.
      const segments: PackSegment[] = [];
      let index = 0;
      while (index < text.length) {
        let matched: string | null = null;
        for (let len = Math.min(8, text.length - index); len >= 2; len -= 1) {
          const slice = text.slice(index, index + len);
          if (starterMap.has(slice)) {
            matched = slice;
            break;
          }
        }
        if (matched) {
          segments.push({ start: index, end: index + matched.length, surface: matched, isWordLike: true });
          index += matched.length;
        } else {
          index += 1;
        }
      }
      return segments.length > 0 ? segments : null;
    },
  };
}

/** Idempotently installs the production pack resolver unless tests already overrode it. */
export function ensureLanguageAdapterPackBridge(force = false): void {
  if (!force && (installedBridge || getLanguageAdapterPackResolver() !== null)) return;
  setLanguageAdapterPackResolver(createLanguageAdapterPackResolver());
  installedBridge = true;
}

export function clearLanguageAdapterPackBridgeCache(): void {
  entryCache.clear();
}
