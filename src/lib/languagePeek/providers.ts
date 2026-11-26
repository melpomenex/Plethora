import {
  listLanguagePacks,
  lookupLanguagePackDictionary,
  type LanguageDictionaryEntryRecord,
  type LanguagePackRecord,
} from "../../api/languagePacks";
import { getStarterPackEntries } from "../languagePacks/catalog";
import type { ParsedDictionaryEntry } from "../languagePacks/types";
import { isAnyAiAvailable, resolveAiPath } from "../ai/provider";
import { getActiveCloudConfig } from "../ai/providers/cloudProvider";
import { providerAllowsKeylessAccess } from "../../utils/llmProviderUtils";
import { ensureCloudAiDisclosure } from "../privacy/cloudAiDisclosure";
import { runTask } from "../ai/tasks/runTask";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../ai/tasks/containment";
import type { AITaskDefinition } from "../ai/tasks/types";
import { isCancelledError } from "../ai/errors";
import { checkString, invalid, isRecord, valid } from "../ai/schemas/common";
import type { DictionaryEntry, DictionarySense } from "../../utils/dictionaryLookup";
import type {
  LanguagePeekLookupResult,
  LanguagePeekProvider,
  LanguagePeekProviderResult,
  LanguagePeekTargetContext,
  PeekAnalysisContext,
} from "./contracts";
import { languagePeekService, localDictionaryProvider, type LanguagePeekService } from "./service";

export interface LanguagePeekLookupContext extends LanguagePeekTargetContext {
  allowAiFallback?: boolean;
}

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_SENSES = 8;

function primaryLanguageCode(languageTag: string | undefined): string {
  return (languageTag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function abortResult(): LanguagePeekLookupResult {
  return { ok: false, failure: { kind: "cancelled" } };
}

function normalizeToken(value: string, languageTag?: string): string {
  const nfc = value.trim().normalize("NFC");
  try {
    return languageTag && languageTag !== "*"
      ? nfc.toLocaleLowerCase(languageTag)
      : nfc.toLowerCase();
  } catch {
    return nfc.toLowerCase();
  }
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<\/?(?:p|div|br|li|ul|ol|tr|td|th|h[1-6]|blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(
  url: string,
  signal?: AbortSignal,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<{ response: Response; timedOut: boolean } | { aborted: true }> {
  if (signal?.aborted) return { aborted: true };

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : undefined;

  try {
    const response = await fetch(url, { signal: controller.signal });
    return { response, timedOut };
  } catch (error) {
    if (signal?.aborted) return { aborted: true };
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------
// 1. Offline Language Pack Provider
// ---------------------------------------------------------------------------

function mapPackRecordsToEntry(
  fallbackWord: string,
  records: LanguageDictionaryEntryRecord[],
  existingAnalysis?: PeekAnalysisContext,
): { dictionary: DictionaryEntry; analysis?: PeekAnalysisContext } {
  const first = records[0]!;
  const senses: DictionarySense[] = [];
  let phonetic: string | undefined;

  for (const record of records) {
    if (!phonetic && record.reading?.trim()) {
      phonetic = record.reading.trim();
    }
    const pos = record.partOfSpeech?.trim() || undefined;
    record.senses.forEach((sense, index) => {
      if (senses.length >= MAX_SENSES) return;
      const definition = sense.definition?.trim() || sense.glosses?.join("; ").trim() || "";
      if (!definition) return;
      const example = record.examples?.[index]?.trim() || (index === 0 ? record.examples?.[0]?.trim() : undefined);
      senses.push({
        ...(pos ? { partOfSpeech: pos } : {}),
        definition,
        ...(example ? { example } : {}),
      });
    });
  }

  const dictionary: DictionaryEntry = {
    word: first.headword || fallbackWord,
    ...(phonetic ? { phonetic } : {}),
    senses,
    synonyms: [],
  };

  const mergedAnalysis: PeekAnalysisContext | undefined =
    existingAnalysis || first.lemma || first.partOfSpeech || Object.keys(first.morphology ?? {}).length > 0
      ? {
          ...existingAnalysis,
          ...(existingAnalysis?.lemma ? {} : first.lemma ? { lemma: first.lemma } : {}),
          ...(existingAnalysis?.partOfSpeech ? {} : first.partOfSpeech ? { partOfSpeech: first.partOfSpeech } : {}),
          ...(existingAnalysis?.morphology
            ? {}
            : Object.keys(first.morphology ?? {}).length > 0
              ? { morphology: first.morphology }
              : {}),
        }
      : undefined;

  return { dictionary, analysis: mergedAnalysis };
}

function starterEntriesMatching(
  entries: ParsedDictionaryEntry[],
  pack: LanguagePackRecord,
  text: string,
  lemma?: string,
): LanguageDictionaryEntryRecord[] {
  const queryNorm = normalizeToken(text, pack.languageTag);
  const lemmaNorm = lemma ? normalizeToken(lemma, pack.languageTag) : "";
  const matches = entries.filter((entry) => {
    const headNorm = normalizeToken(entry.normalizedHeadword || entry.headword, pack.languageTag);
    const entryLemmaNorm = entry.lemma ? normalizeToken(entry.lemma, pack.languageTag) : "";
    return (
      headNorm === queryNorm ||
      entryLemmaNorm === queryNorm ||
      (Boolean(lemmaNorm) && (headNorm === lemmaNorm || entryLemmaNorm === lemmaNorm))
    );
  });

  return matches.map((entry, idx) => ({
    id: `${pack.id}:${entry.headword}:${idx}`,
    packId: pack.id,
    languageTag: pack.languageTag,
    headword: entry.headword,
    normalizedHeadword: entry.normalizedHeadword,
    reading: entry.reading,
    lemma: entry.lemma,
    partOfSpeech: entry.pos,
    morphology: entry.morphology ?? {},
    senses: entry.senses,
    examples: entry.examples ?? [],
    frequencyRank: entry.frequencyRank,
  }));
}

export const offlinePackDictionaryProvider: LanguagePeekProvider = {
  id: "offline-language-pack",
  version: "1.0.0",
  supports: (languageTag) => Boolean(languageTag && languageTag.trim().length > 0),
  async lookup({ text, languageTag, context, signal }) {
    if (signal?.aborted) return abortResult();
    const rawTag = languageTag?.trim() ?? "";
    if (!rawTag) {
      return { ok: false, failure: { kind: "unsupported-language" } };
    }

    const primary = primaryLanguageCode(rawTag);
    const lemma = context?.analysis?.lemma?.trim() || undefined;

    if (rawTag !== "*") {
      try {
        const directRecords = await lookupLanguagePackDictionary(rawTag, text, { lemma, limit: 10 });
        if (signal?.aborted) return abortResult();
        if (directRecords.length > 0) {
          const mapped = mapPackRecordsToEntry(text, directRecords, context?.analysis);
          if (mapped.dictionary.senses.length > 0) {
            return {
              ok: true,
              result: {
                providerId: offlinePackDictionaryProvider.id,
                providerVersion: offlinePackDictionaryProvider.version,
                dictionary: mapped.dictionary,
                analysis: mapped.analysis,
                provenance: "local",
              },
            };
          }
        }
      } catch {
        // Fall through to pack installation check.
      }
    }

    let installedPacks: LanguagePackRecord[] = [];
    try {
      const packs = await listLanguagePacks(rawTag === "*" ? undefined : primary);
      if (signal?.aborted) return abortResult();
      installedPacks = packs.filter((pack) => {
        if (pack.status !== "installed") return false;
        if (rawTag === "*") return true;
        return (
          primaryLanguageCode(pack.languageTag) === primary ||
          primaryLanguageCode(pack.targetLanguage) === primary
        );
      });
    } catch {
      return {
        ok: false,
        failure: { kind: "unavailable", message: "No offline dictionary pack installed" },
      };
    }

    if (installedPacks.length === 0) {
      return {
        ok: false,
        failure: { kind: "unavailable", message: "No offline dictionary pack installed" },
      };
    }

    if (rawTag === "*") {
      for (const pack of installedPacks) {
        try {
          const records = await lookupLanguagePackDictionary(pack.languageTag, text, { lemma, limit: 10 });
          if (signal?.aborted) return abortResult();
          if (records.length > 0) {
            const mapped = mapPackRecordsToEntry(text, records, context?.analysis);
            if (mapped.dictionary.senses.length > 0) {
              return {
                ok: true,
                result: {
                  providerId: offlinePackDictionaryProvider.id,
                  providerVersion: offlinePackDictionaryProvider.version,
                  dictionary: mapped.dictionary,
                  analysis: mapped.analysis,
                  provenance: "local",
                },
              };
            }
          }
        } catch {
          // Continue checking remaining installed packs.
        }
      }
    }

    // Embedded starter pack fallback ONLY when that starter pack is actually installed.
    for (const pack of installedPacks) {
      const starterEntries = getStarterPackEntries(pack.id);
      if (!starterEntries) continue;
      const starterRecords = starterEntriesMatching(starterEntries, pack, text, lemma);
      if (starterRecords.length > 0) {
        const mapped = mapPackRecordsToEntry(text, starterRecords, context?.analysis);
        if (mapped.dictionary.senses.length > 0) {
          return {
            ok: true,
            result: {
              providerId: offlinePackDictionaryProvider.id,
              providerVersion: offlinePackDictionaryProvider.version,
              dictionary: mapped.dictionary,
              analysis: mapped.analysis,
              provenance: "local",
            },
          };
        }
      }
    }

    return { ok: false, failure: { kind: "not-found" } };
  },
};

// ---------------------------------------------------------------------------
// 2. Jisho Japanese Dictionary Provider
// ---------------------------------------------------------------------------

interface JishoEntry {
  slug?: string;
  japanese?: Array<{ word?: string; reading?: string }>;
  senses?: Array<{
    english_definitions?: string[];
    parts_of_speech?: string[];
  }>;
}

interface JishoResponse {
  data?: JishoEntry[];
}

async function queryJisho(
  term: string,
  signal?: AbortSignal,
): Promise<{ status: "ok"; entry: DictionaryEntry } | { status: "not-found" } | { status: "unavailable"; message?: string } | { status: "cancelled" }> {
  const url = `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(term)}`;
  const fetched = await fetchWithTimeout(url, signal);
  if ("aborted" in fetched) return { status: "cancelled" };

  const { response } = fetched;
  if (response.status === 404) return { status: "not-found" };
  if (!response.ok) return { status: "unavailable", message: `Jisho returned HTTP ${response.status}` };

  const payload = (await response.json()) as JishoResponse;
  const items = Array.isArray(payload?.data) ? payload.data : [];
  if (items.length === 0) return { status: "not-found" };

  const exact = items.find((item) =>
    item.slug === term ||
    item.japanese?.some((jp) => jp.word === term || jp.reading === term),
  ) ?? items[0]!;

  const primaryJp = exact.japanese?.[0];
  const word = primaryJp?.word?.trim() || primaryJp?.reading?.trim() || exact.slug?.trim() || term;
  const phonetic = primaryJp?.reading?.trim() || undefined;
  const senses: DictionarySense[] = [];

  for (const sense of exact.senses ?? []) {
    if (senses.length >= MAX_SENSES) break;
    const defs = (sense.english_definitions ?? []).map((item) => item.trim()).filter(Boolean);
    if (defs.length === 0) continue;
    const pos = (sense.parts_of_speech ?? []).map((item) => item.trim()).filter(Boolean).join(", ") || undefined;
    senses.push({
      ...(pos ? { partOfSpeech: pos } : {}),
      definition: defs.join("; "),
    });
  }

  if (senses.length === 0) return { status: "not-found" };

  return {
    status: "ok",
    entry: {
      word,
      ...(phonetic ? { phonetic } : {}),
      senses,
      synonyms: [],
    },
  };
}

export const jishoDictionaryProvider: LanguagePeekProvider = {
  id: "jisho.org",
  version: "v1",
  supports: (languageTag) => primaryLanguageCode(languageTag) === "ja",
  async lookup({ text, languageTag, context, signal }) {
    if (signal?.aborted) return abortResult();
    if (!jishoDictionaryProvider.supports(languageTag)) {
      return { ok: false, failure: { kind: "unsupported-language" } };
    }
    if (isOffline()) {
      return { ok: false, failure: { kind: "offline-uncached" } };
    }

    try {
      let res = await queryJisho(text, signal);
      if (res.status === "not-found") {
        const lemma = context?.analysis?.lemma?.trim();
        if (lemma && lemma !== text.trim()) {
          res = await queryJisho(lemma, signal);
        }
      }
      if (res.status === "cancelled") return abortResult();
      if (res.status === "not-found") return { ok: false, failure: { kind: "not-found" } };
      if (res.status === "unavailable") {
        return { ok: false, failure: { kind: "unavailable", message: res.message } };
      }
      return {
        ok: true,
        result: {
          providerId: jishoDictionaryProvider.id,
          providerVersion: jishoDictionaryProvider.version,
          dictionary: res.entry,
          analysis: context?.analysis,
          provenance: "dedicated",
        },
      };
    } catch (error) {
      if (signal?.aborted) return abortResult();
      return {
        ok: false,
        failure: isOffline()
          ? { kind: "offline-uncached" }
          : { kind: "unavailable", message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 3. Wiktionary Multilingual REST Provider
// ---------------------------------------------------------------------------

interface WiktionaryDefinitionItem {
  definition?: string;
  examples?: string[];
  parsedExamples?: Array<{ example?: string; translation?: string }>;
}

interface WiktionarySection {
  partOfSpeech?: string;
  language?: string;
  definitions?: WiktionaryDefinitionItem[];
}

function extractWiktionaryEntry(
  payload: unknown,
  term: string,
  primary: string,
): DictionaryEntry | null {
  if (!isRecord(payload)) return null;

  let sections: WiktionarySection[] | undefined;
  const exact = payload[primary];
  if (Array.isArray(exact)) {
    sections = exact as WiktionarySection[];
  } else {
    const matchedKey = Object.keys(payload).find(
      (key) => key.toLowerCase() === primary || key.toLowerCase().startsWith(`${primary}-`),
    );
    if (matchedKey && Array.isArray(payload[matchedKey])) {
      sections = payload[matchedKey] as WiktionarySection[];
    }
  }

  if (!sections || sections.length === 0) return null;

  const senses: DictionarySense[] = [];
  for (const section of sections) {
    const partOfSpeech = typeof section.partOfSpeech === "string" && section.partOfSpeech.trim()
      ? stripHtml(section.partOfSpeech)
      : undefined;
    for (const def of section.definitions ?? []) {
      if (senses.length >= MAX_SENSES) break;
      const definition = typeof def.definition === "string" ? stripHtml(def.definition) : "";
      if (!definition) continue;
      let example: string | undefined;
      if (Array.isArray(def.examples) && typeof def.examples[0] === "string") {
        const cleaned = stripHtml(def.examples[0]);
        if (cleaned) example = cleaned;
      } else if (Array.isArray(def.parsedExamples) && def.parsedExamples[0]?.example) {
        const base = stripHtml(def.parsedExamples[0].example);
        const trans = def.parsedExamples[0].translation
          ? stripHtml(def.parsedExamples[0].translation)
          : "";
        if (base) example = trans ? `${base} — ${trans}` : base;
      }
      senses.push({
        ...(partOfSpeech ? { partOfSpeech } : {}),
        definition,
        ...(example ? { example } : {}),
      });
    }
  }

  if (senses.length === 0) return null;
  return {
    word: term,
    senses,
    synonyms: [],
  };
}

async function queryWiktionaryEndpoint(
  hostPrefix: string,
  term: string,
  primary: string,
  signal?: AbortSignal,
): Promise<{ status: "ok"; entry: DictionaryEntry } | { status: "not-found" } | { status: "unavailable"; message?: string } | { status: "cancelled" }> {
  const url = `https://${hostPrefix}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`;
  const fetched = await fetchWithTimeout(url, signal);
  if ("aborted" in fetched) return { status: "cancelled" };

  const { response } = fetched;
  if (response.status === 404) return { status: "not-found" };
  if (!response.ok) return { status: "unavailable", message: `Wiktionary returned HTTP ${response.status}` };

  const data: unknown = await response.json();
  const entry = extractWiktionaryEntry(data, term, primary);
  if (!entry) return { status: "not-found" };
  return { status: "ok", entry };
}

async function queryWiktionaryTerm(
  term: string,
  primary: string,
  signal?: AbortSignal,
): Promise<{ status: "ok"; entry: DictionaryEntry } | { status: "not-found" } | { status: "unavailable"; message?: string } | { status: "cancelled" }> {
  const enRes = await queryWiktionaryEndpoint("en", term, primary, signal);
  if (enRes.status === "ok" || enRes.status === "cancelled") return enRes;
  if (primary !== "en") {
    const localRes = await queryWiktionaryEndpoint(primary, term, primary, signal);
    if (localRes.status === "ok" || localRes.status === "cancelled") return localRes;
    if (enRes.status === "unavailable") return enRes;
    return localRes;
  }
  return enRes;
}

export const wiktionaryMultilingualProvider: LanguagePeekProvider = {
  id: "wiktionary-rest",
  version: "v1",
  supports: (languageTag) => languageTag === undefined || languageTag === "*" || languageTag.trim().length > 0,
  async lookup({ text, languageTag, context, signal }) {
    if (signal?.aborted) return abortResult();
    if (isOffline()) {
      return { ok: false, failure: { kind: "offline-uncached" } };
    }

    const rawTag = (languageTag ?? "").trim();
    const primary = rawTag && rawTag !== "*" ? primaryLanguageCode(rawTag) : "en";

    try {
      let res = await queryWiktionaryTerm(text, primary, signal);
      if (res.status === "not-found") {
        const lemma = context?.analysis?.lemma?.trim();
        if (lemma && lemma.toLowerCase() !== text.trim().toLowerCase()) {
          res = await queryWiktionaryTerm(lemma, primary, signal);
        }
      }
      if (res.status === "cancelled") return abortResult();
      if (res.status === "not-found") return { ok: false, failure: { kind: "not-found" } };
      if (res.status === "unavailable") {
        return { ok: false, failure: { kind: "unavailable", message: res.message } };
      }

      return {
        ok: true,
        result: {
          providerId: wiktionaryMultilingualProvider.id,
          providerVersion: wiktionaryMultilingualProvider.version,
          dictionary: res.entry,
          analysis: context?.analysis,
          provenance: "dedicated",
        },
      };
    } catch (error) {
      if (signal?.aborted) return abortResult();
      return {
        ok: false,
        failure: isOffline()
          ? { kind: "offline-uncached" }
          : { kind: "unavailable", message: error instanceof Error ? error.message : String(error) },
      };
    }
  },
};

// ---------------------------------------------------------------------------
// 4. AI Dictionary Fallback Provider
// ---------------------------------------------------------------------------

interface AiDictionaryPayload {
  word: string;
  lemma?: string;
  partOfSpeech?: string;
  reading?: string;
  senses: Array<{
    definition: string;
    example?: string;
  }>;
}

interface AiDictionaryTaskInput {
  text: string;
  languageTag?: string;
  sentenceText?: string;
}

const aiDictionaryTask: AITaskDefinition<AiDictionaryTaskInput, AiDictionaryPayload> = {
  id: "language-dictionary-peek",
  taskType: "prompt",
  modelClass: "fast",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nYou are a concise multilingual dictionary. Provide an accurate dictionary entry for the target word or phrase in the specified language. Return ONLY valid JSON matching the schema with word, optional lemma, optional partOfSpeech, optional reading, and senses (each with definition and optional example).`,
  buildInput: ({ text, languageTag, sentenceText }) => ({
    text: [
      `Target language: ${languageTag?.trim() || "unknown"}`,
      "Target term:",
      wrapUntrustedBlock("term", text),
      ...(sentenceText ? ["Sentence context:", wrapUntrustedBlock("sentence", sentenceText)] : []),
    ].join("\n"),
  }),
  outputKind: "structured",
  schema: {
    name: "LanguageDictionaryPayload",
    nativeName: "LanguageDictionaryPayload",
    json: '{"word":"string","lemma":"string","partOfSpeech":"string","reading":"string","senses":[{"definition":"string","example":"string"}]}',
  },
  validate(output, input) {
    if (!isRecord(output)) return invalid("output", "expected JSON object");
    const errors: string[] = [];
    const word = typeof output.word === "string" && output.word.trim()
      ? output.word.trim()
      : input.text;
    const lemma = typeof output.lemma === "string" && output.lemma.trim() ? output.lemma.trim() : undefined;
    const partOfSpeech = typeof output.partOfSpeech === "string" && output.partOfSpeech.trim()
      ? output.partOfSpeech.trim()
      : undefined;
    const reading = typeof output.reading === "string" && output.reading.trim()
      ? output.reading.trim()
      : undefined;

    if (!Array.isArray(output.senses) || output.senses.length === 0) {
      errors.push("senses: expected non-empty array");
      return { ok: false, errors };
    }

    const senses: AiDictionaryPayload["senses"] = [];
    for (let i = 0; i < Math.min(output.senses.length, MAX_SENSES); i += 1) {
      const item = output.senses[i];
      if (!isRecord(item)) {
        errors.push(`senses[${i}]: expected object`);
        continue;
      }
      const definition = checkString(item.definition, `senses[${i}].definition`, errors, { maxLength: 500 });
      if (!definition) continue;
      const example = typeof item.example === "string" && item.example.trim()
        ? item.example.trim().slice(0, 300)
        : undefined;
      senses.push({ definition, ...(example ? { example } : {}) });
    }

    if (errors.length > 0 || senses.length === 0) {
      return { ok: false, errors: errors.length > 0 ? errors : ["senses: no valid definitions"] };
    }

    return valid({
      word,
      ...(lemma ? { lemma } : {}),
      ...(partOfSpeech ? { partOfSpeech } : {}),
      ...(reading ? { reading } : {}),
      senses,
    });
  },
  maxOutputTokens: 384,
  timeoutMs: 30_000,
  budgetPolicy: "pre-budgeted",
  streaming: false,
};

export const aiDictionaryFallbackProvider: LanguagePeekProvider = {
  id: "plethora-ai-dict",
  version: "1.0.0",
  supports: () => true,
  async lookup({ text, languageTag, context, signal }) {
    if (signal?.aborted) return abortResult();
    const extended = context as LanguagePeekLookupContext | undefined;
    if (extended?.allowAiFallback === false) {
      return { ok: false, failure: { kind: "unavailable", message: "AI fallback disabled" } };
    }

    const available = await isAnyAiAvailable("prompt");
    if (signal?.aborted) return abortResult();
    if (!available) {
      return { ok: false, failure: { kind: "unavailable", message: "No AI provider available" } };
    }

    const aiPath = await resolveAiPath("prompt");
    if (signal?.aborted) return abortResult();
    if (aiPath === "none") {
      return { ok: false, failure: { kind: "unavailable", message: "No AI provider available" } };
    }

    if (aiPath === "cloud") {
      if (isOffline()) {
        return { ok: false, failure: { kind: "offline-uncached" } };
      }
      const config = getActiveCloudConfig();
      const isLocal = config ? providerAllowsKeylessAccess(config.provider, config.baseUrl) : false;
      const disclosed = await ensureCloudAiDisclosure({
        featureClass: "ai_actions",
        provider: config?.provider ?? "cloud",
        isLocal,
      });
      if (signal?.aborted) return abortResult();
      if (!disclosed) {
        return { ok: false, failure: { kind: "unavailable", message: "Cloud AI disclosure declined" } };
      }
    }

    try {
      const taskResult = await runTask(
        aiDictionaryTask,
        {
          text,
          languageTag,
          sentenceText: context?.sentence?.text,
        },
        { signal },
      );
      if (signal?.aborted) return abortResult();

      const payload = taskResult.output;
      const dictionary: DictionaryEntry = {
        word: payload.word || text,
        ...(payload.reading ? { phonetic: payload.reading } : {}),
        senses: payload.senses.map((sense) => ({
          ...(payload.partOfSpeech ? { partOfSpeech: payload.partOfSpeech } : {}),
          definition: sense.definition,
          ...(sense.example ? { example: sense.example } : {}),
        })),
        synonyms: [],
      };

      const analysis: PeekAnalysisContext | undefined =
        context?.analysis || payload.lemma || payload.partOfSpeech
          ? {
              ...context?.analysis,
              ...(context?.analysis?.lemma ? {} : payload.lemma ? { lemma: payload.lemma } : {}),
              ...(context?.analysis?.partOfSpeech
                ? {}
                : payload.partOfSpeech
                  ? { partOfSpeech: payload.partOfSpeech }
                  : {}),
            }
          : undefined;

      const result: LanguagePeekProviderResult = {
        providerId: aiDictionaryFallbackProvider.id,
        providerVersion: aiDictionaryFallbackProvider.version,
        dictionary,
        analysis,
        provenance: "ai",
      };
      return { ok: true, result };
    } catch (error) {
      if (signal?.aborted || isCancelledError(error)) return abortResult();
      return {
        ok: false,
        failure: {
          kind: "unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
};

export function createDefaultLanguagePeekProviders(): LanguagePeekProvider[] {
  return [
    offlinePackDictionaryProvider,
    jishoDictionaryProvider,
    localDictionaryProvider,
    wiktionaryMultilingualProvider,
    aiDictionaryFallbackProvider,
  ];
}

export function registerDefaultLanguagePeekProviders(
  service: LanguagePeekService = languagePeekService,
): void {
  const ordered = createDefaultLanguagePeekProviders();
  for (const provider of ordered) {
    service.unregisterProvider(provider.id);
  }
  for (const provider of ordered) {
    service.registerProvider(provider);
  }
}

registerDefaultLanguagePeekProviders(languagePeekService);
