import JSZip from "jszip";
import { normalizeForLookup } from "../languageProcessing/unicode";
import {
  LanguagePackError,
  type DictionarySense,
  type LanguagePackFormat,
  type ParsedDictionaryEntry,
  type StarDictInputFiles,
} from "./types";

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

function baseLanguageSubtag(tag: string | undefined): string {
  if (!tag) return "";
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function uniqueStrings(items: Iterable<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const trimmed = item?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripMarkup(text: string): string {
  return decodeXmlEntities(
    text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|def|dtrn|ex)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractXmlTagTexts(xml: string, tagNames: readonly string[]): string[] {
  const results: string[] = [];
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
      const cleaned = stripMarkup(match[1] ?? "");
      if (cleaned) results.push(cleaned);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Yomichan / Yomitan ZIP parser
// ---------------------------------------------------------------------------

export interface YomichanIndexMeta {
  title?: string;
  revision?: string;
  format?: number;
  version?: number;
  author?: string;
  url?: string;
  description?: string;
  attribution?: string;
  frequencyMode?: string;
}

export interface YomichanParseResult {
  index: YomichanIndexMeta | null;
  entries: ParsedDictionaryEntry[];
}

function extractYomichanText(node: unknown): string {
  if (typeof node === "string") return node.trim();
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) {
    return node.map(extractYomichanText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text.trim();
    if ("content" in obj) return extractYomichanText(obj.content);
  }
  return "";
}

function numericSuffix(fileName: string): number {
  const match = /(\d+)\.json$/i.exec(fileName);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function extractYomichanFreqNumber(payload: unknown): number | undefined {
  if (typeof payload === "number" && Number.isFinite(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.value === "number" && Number.isFinite(obj.value)) return obj.value;
    if ("frequency" in obj) return extractYomichanFreqNumber(obj.frequency);
  }
  return undefined;
}

function extractYomichanFreqReading(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const reading = (payload as Record<string, unknown>).reading;
    if (typeof reading === "string" && reading.trim()) return reading.trim();
  }
  return undefined;
}

/**
 * Parse a Yomichan / Yomitan `.zip` dictionary archive (`index.json` +
 * `term_bank_*.json` + optional `term_meta_bank_*.json`).
 */
export async function parseYomichanZipWithMeta(
  bytes: Uint8Array,
  languageTag: string,
): Promise<YomichanParseResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new LanguagePackError("invalid-format", `Invalid Yomichan ZIP archive: ${String(error)}`);
  }

  const filePaths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  const indexPath = filePaths.find((path) => /(?:^|\/)index\.json$/i.test(path));
  let index: YomichanIndexMeta | null = null;
  if (indexPath) {
    try {
      const rawIndex = await zip.files[indexPath].async("string");
      index = JSON.parse(rawIndex) as YomichanIndexMeta;
    } catch (error) {
      throw new LanguagePackError("invalid-format", `Invalid index.json in Yomichan ZIP: ${String(error)}`);
    }
  }

  const termMetaPaths = filePaths
    .filter((path) => /(?:^|\/)term_meta_bank_\d+\.json$/i.test(path))
    .sort((a, b) => numericSuffix(a) - numericSuffix(b));

  const frequencyByTermReading = new Map<string, number>();
  const frequencyByTerm = new Map<string, number>();

  for (const metaPath of termMetaPaths) {
    try {
      const rawMeta = await zip.files[metaPath].async("string");
      const rows = JSON.parse(rawMeta) as unknown;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 3) continue;
        const term = cleanString(row[0]);
        const mode = cleanString(row[1]);
        if (!term || mode !== "freq") continue;
        const freq = extractYomichanFreqNumber(row[2]);
        if (freq === undefined) continue;
        const metaReading = extractYomichanFreqReading(row[2]);
        if (metaReading) {
          const key = `${term}\u0000${metaReading}`;
          if (!frequencyByTermReading.has(key)) frequencyByTermReading.set(key, freq);
        }
        if (!frequencyByTerm.has(term)) frequencyByTerm.set(term, freq);
      }
    } catch {
      // Ignore malformed optional meta bank; term banks remain primary.
    }
  }

  const termBankPaths = filePaths
    .filter((path) => /(?:^|\/)term_bank_\d+\.json$/i.test(path))
    .sort((a, b) => numericSuffix(a) - numericSuffix(b));

  if (termBankPaths.length === 0) {
    throw new LanguagePackError(
      "invalid-format",
      "Yomichan ZIP archive contains no term_bank_*.json files",
    );
  }

  const entries: ParsedDictionaryEntry[] = [];
  for (const bankPath of termBankPaths) {
    let bankRows: unknown;
    try {
      const rawBank = await zip.files[bankPath].async("string");
      bankRows = JSON.parse(rawBank);
    } catch (error) {
      throw new LanguagePackError("invalid-format", `Invalid JSON in ${bankPath}: ${String(error)}`);
    }

    if (!Array.isArray(bankRows)) {
      throw new LanguagePackError("invalid-format", `${bankPath} must contain a JSON array`);
    }

    for (const row of bankRows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const headword = cleanString(row[0]);
      if (!headword) continue;

      const reading = cleanString(row[1]);
      const defTags = cleanString(row[2])?.split(/\s+/).filter(Boolean) ?? [];
      const rules = cleanString(row[3])?.split(/\s+/).filter(Boolean) ?? [];
      const score = typeof row[4] === "number" && Number.isFinite(row[4]) ? row[4] : undefined;
      const rawDefs = Array.isArray(row[5]) ? row[5] : [row[5]];
      const termTags = cleanString(row[7])?.split(/\s+/).filter(Boolean) ?? [];

      const tags = uniqueStrings([...defTags, ...termTags]);
      const senses: DictionarySense[] = [];
      for (const defItem of rawDefs) {
        const text = extractYomichanText(defItem);
        if (!text) continue;
        senses.push({
          definition: text,
          ...(tags.length > 0 ? { tags } : {}),
        });
      }
      if (senses.length === 0) continue;

      const freqKey = reading ? `${headword}\u0000${reading}` : "";
      const frequencyRank =
        (freqKey ? frequencyByTermReading.get(freqKey) : undefined) ??
        frequencyByTerm.get(headword) ??
        (score !== undefined && score > 0 ? score : undefined);

      const pos = defTags[0] ?? rules[0];
      const morphology =
        rules.length > 0 ? { inflectionRules: rules.join(" ") } : undefined;

      entries.push({
        headword,
        normalizedHeadword: normalizeForLookup(headword, languageTag),
        ...(reading && reading !== headword ? { reading } : {}),
        ...(pos ? { pos } : {}),
        ...(morphology ? { morphology } : {}),
        senses,
        ...(frequencyRank !== undefined ? { frequencyRank } : {}),
      });
    }
  }

  return { index, entries };
}

export async function parseYomichanZip(
  bytes: Uint8Array,
  languageTag: string,
): Promise<ParsedDictionaryEntry[]> {
  const { entries } = await parseYomichanZipWithMeta(bytes, languageTag);
  return entries;
}

// ---------------------------------------------------------------------------
// JSON & Kaikki JSONL parser
// ---------------------------------------------------------------------------

function normalizeSenseArray(raw: unknown): DictionarySense[] {
  if (!Array.isArray(raw)) {
    const single = cleanString(raw);
    return single ? [{ definition: single }] : [];
  }
  const senses: DictionarySense[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const def = item.trim();
      if (def) senses.push({ definition: def });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const glosses = Array.isArray(obj.glosses)
        ? obj.glosses.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
        : Array.isArray(obj.raw_glosses)
          ? obj.raw_glosses.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
          : undefined;
      const tags = Array.isArray(obj.tags)
        ? obj.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        : undefined;
      const definition =
        cleanString(obj.definition) ??
        (glosses && glosses.length > 0 ? glosses.join("; ") : undefined);
      if (!definition) continue;
      senses.push({
        definition,
        ...(glosses && glosses.length > 0 ? { glosses } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
      });
    }
  }
  return senses;
}

function parseGenericJsonEntry(raw: unknown, languageTag: string): ParsedDictionaryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const headword =
    cleanString(obj.headword) ??
    cleanString(obj.word) ??
    cleanString(obj.term);
  if (!headword) return null;

  const reading =
    cleanString(obj.reading) ??
    cleanString(obj.phonetic) ??
    cleanString(obj.kana) ??
    cleanString(obj.pinyin);
  const lemma = cleanString(obj.lemma) ?? cleanString(obj.baseForm);
  const pos = cleanString(obj.pos) ?? cleanString(obj.partOfSpeech);

  let senses = normalizeSenseArray(obj.senses ?? obj.definitions ?? obj.meanings);
  if (senses.length === 0) {
    const def = cleanString(obj.definition) ?? cleanString(obj.gloss);
    if (def) senses = [{ definition: def }];
  }
  if (senses.length === 0) return null;

  const examples = Array.isArray(obj.examples)
    ? uniqueStrings(obj.examples.map((item) => (typeof item === "string" ? item : undefined)))
    : undefined;

  const morphology =
    obj.morphology && typeof obj.morphology === "object" && !Array.isArray(obj.morphology)
      ? Object.fromEntries(
          Object.entries(obj.morphology as Record<string, unknown>)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)]),
        )
      : undefined;

  const rawFreq = obj.frequencyRank ?? obj.frequency;
  const frequencyRank =
    typeof rawFreq === "number" && Number.isFinite(rawFreq) ? rawFreq : undefined;

  return {
    headword,
    normalizedHeadword:
      cleanString(obj.normalizedHeadword) ?? normalizeForLookup(headword, languageTag),
    ...(reading ? { reading } : {}),
    ...(lemma ? { lemma } : {}),
    ...(pos ? { pos } : {}),
    ...(morphology && Object.keys(morphology).length > 0 ? { morphology } : {}),
    senses,
    ...(examples && examples.length > 0 ? { examples } : {}),
    ...(frequencyRank !== undefined ? { frequencyRank } : {}),
  };
}

function extractKaikkiReading(record: Record<string, unknown>): string | undefined {
  const direct = cleanString(record.reading);
  if (direct) return direct;
  if (Array.isArray(record.sounds)) {
    for (const sound of record.sounds) {
      if (!sound || typeof sound !== "object") continue;
      const s = sound as Record<string, unknown>;
      const candidate =
        cleanString(s.pinyin) ??
        cleanString(s.romaji) ??
        cleanString(s.kana) ??
        cleanString(s.hangeul) ??
        cleanString(s.zh_pron) ??
        cleanString(s.ipa) ??
        cleanString(s.other);
      if (candidate) return candidate;
    }
  }
  if (Array.isArray(record.forms)) {
    for (const form of record.forms) {
      if (!form || typeof form !== "object") continue;
      const f = form as Record<string, unknown>;
      const tags = Array.isArray(f.tags) ? f.tags : [];
      if (tags.includes("romanization") || tags.includes("kana") || tags.includes("pinyin")) {
        const candidate = cleanString(f.form);
        if (candidate) return candidate;
      }
    }
  }
  return undefined;
}

function parseKaikkiRecord(
  record: Record<string, unknown>,
  languageTag: string,
): ParsedDictionaryEntry | null {
  const langCode = cleanString(record.lang_code);
  const targetBase = baseLanguageSubtag(languageTag);
  if (langCode && targetBase && targetBase !== "und" && baseLanguageSubtag(langCode) !== targetBase) {
    return null;
  }

  const headword = cleanString(record.word) ?? cleanString(record.headword);
  if (!headword) return null;

  const pos = cleanString(record.pos);
  const reading = extractKaikkiReading(record);
  const examples: string[] = [];
  const senses: DictionarySense[] = [];
  let lemma = cleanString(record.lemma);

  const rawSenses = Array.isArray(record.senses) ? record.senses : [];
  for (const rawSense of rawSenses) {
    if (!rawSense || typeof rawSense !== "object") continue;
    const sense = rawSense as Record<string, unknown>;
    const glosses = uniqueStrings(
      Array.isArray(sense.glosses)
        ? (sense.glosses as unknown[]).map((g) => (typeof g === "string" ? g : undefined))
        : Array.isArray(sense.raw_glosses)
          ? (sense.raw_glosses as unknown[]).map((g) => (typeof g === "string" ? g : undefined))
          : [],
    );
    const tags = uniqueStrings(
      Array.isArray(sense.tags)
        ? (sense.tags as unknown[]).map((t) => (typeof t === "string" ? t : undefined))
        : [],
    );

    if (!lemma && Array.isArray(sense.form_of) && sense.form_of.length > 0) {
      const firstFormOf = sense.form_of[0];
      if (firstFormOf && typeof firstFormOf === "object") {
        lemma = cleanString((firstFormOf as Record<string, unknown>).word);
      }
    }

    if (Array.isArray(sense.examples)) {
      for (const ex of sense.examples) {
        if (typeof ex === "string") {
          const cleaned = ex.trim();
          if (cleaned) examples.push(cleaned);
        } else if (ex && typeof ex === "object") {
          const exObj = ex as Record<string, unknown>;
          const text = cleanString(exObj.text);
          const english = cleanString(exObj.english) ?? cleanString(exObj.translation);
          if (text) {
            examples.push(english ? `${text} — ${english}` : text);
          }
        }
      }
    }

    const definition =
      cleanString(sense.definition) ??
      (glosses.length > 0 ? glosses.join("; ") : undefined) ??
      (lemma ? `form of ${lemma}` : undefined);
    if (!definition) continue;

    senses.push({
      definition,
      ...(glosses.length > 0 ? { glosses } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
  }

  if (senses.length === 0) return null;

  if (!lemma && Array.isArray(record.forms)) {
    for (const form of record.forms) {
      if (!form || typeof form !== "object") continue;
      const f = form as Record<string, unknown>;
      const tags = Array.isArray(f.tags) ? f.tags : [];
      if (tags.includes("canonical") || tags.includes("infinitive")) {
        const candidate = cleanString(f.form);
        if (candidate) {
          lemma = candidate;
          break;
        }
      }
    }
  }

  const morphology: Record<string, string> = {};
  if (Array.isArray(record.forms)) {
    const formTags = uniqueStrings(
      record.forms.flatMap((form) =>
        form && typeof form === "object" && Array.isArray((form as Record<string, unknown>).tags)
          ? ((form as Record<string, unknown>).tags as unknown[]).map((t) =>
              typeof t === "string" ? t : undefined,
            )
          : [],
      ),
    );
    if (formTags.length > 0) {
      morphology.formTags = formTags.slice(0, 8).join(",");
    }
  }
  const rawFreq = record.frequencyRank ?? record.frequency;
  const frequencyRank =
    typeof rawFreq === "number" && Number.isFinite(rawFreq) ? rawFreq : undefined;

  const uniqueExamples = uniqueStrings(examples);
  return {
    headword,
    normalizedHeadword: normalizeForLookup(headword, languageTag),
    ...(reading ? { reading } : {}),
    ...(lemma ? { lemma } : {}),
    ...(pos ? { pos } : {}),
    ...(Object.keys(morphology).length > 0 ? { morphology } : {}),
    senses,
    ...(uniqueExamples.length > 0 ? { examples: uniqueExamples } : {}),
    ...(frequencyRank !== undefined ? { frequencyRank } : {}),
  };
}

function looksLikeKaikkiObject(obj: Record<string, unknown>): boolean {
  if (typeof obj.word !== "string") return false;
  if ("lang_code" in obj) return true;
  if (Array.isArray(obj.senses)) {
    return obj.senses.some(
      (s) => s && typeof s === "object" && ("glosses" in s || "raw_glosses" in s || "form_of" in s),
    );
  }
  return false;
}

/**
 * Parse newline-delimited Kaikki / Wiktextract JSONL lines.
 */
export function parseKaikkiJsonl(text: string, languageTag: string): ParsedDictionaryEntry[] {
  const entries: ParsedDictionaryEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new LanguagePackError(
        "invalid-format",
        `Invalid JSONL at line ${i + 1}: ${String(error)}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new LanguagePackError(
        "invalid-format",
        `Expected JSON object at JSONL line ${i + 1}`,
      );
    }
    const obj = parsed as Record<string, unknown>;
    const entry = looksLikeKaikkiObject(obj)
      ? parseKaikkiRecord(obj, languageTag)
      : parseGenericJsonEntry(obj, languageTag);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Parse Plethora pack JSON (`{ entries: [...] }` or `[...]`) as well as
 * Kaikki/Wiktextract JSONL line-by-line input.
 */
export function parseJsonDictionary(text: string, languageTag: string): ParsedDictionaryEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new LanguagePackError("invalid-format", `Invalid JSON array: ${String(error)}`);
    }
    if (!Array.isArray(parsed)) {
      throw new LanguagePackError("invalid-format", "Expected JSON array of dictionary entries");
    }
    const entries: ParsedDictionaryEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const entry = looksLikeKaikkiObject(obj)
        ? parseKaikkiRecord(obj, languageTag)
        : parseGenericJsonEntry(obj, languageTag);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  // If the text is a single JSON object (e.g. `{ manifest, entries }`), try JSON.parse;
  // if multiple lines are JSON objects (JSONL), fall through to line-by-line parsing.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.entries)) {
        const entries: ParsedDictionaryEntry[] = [];
        for (const item of obj.entries) {
          if (!item || typeof item !== "object") continue;
          const itemObj = item as Record<string, unknown>;
          const entry = looksLikeKaikkiObject(itemObj)
            ? parseKaikkiRecord(itemObj, languageTag)
            : parseGenericJsonEntry(itemObj, languageTag);
          if (entry) entries.push(entry);
        }
        return entries;
      }
      if (looksLikeKaikkiObject(obj)) {
        const single = parseKaikkiRecord(obj, languageTag);
        return single ? [single] : [];
      }
      const singleGeneric = parseGenericJsonEntry(obj, languageTag);
      if (singleGeneric) return [singleGeneric];
      throw new LanguagePackError(
        "invalid-format",
        "JSON object does not contain an entries array or dictionary entry fields",
      );
    }
  } catch (error) {
    if (error instanceof LanguagePackError) throw error;
    // Likely JSONL (multiple JSON objects separated by newlines).
  }

  return parseKaikkiJsonl(trimmed, languageTag);
}

// ---------------------------------------------------------------------------
// TSV parser
// ---------------------------------------------------------------------------

/**
 * Parse tab-separated dictionary rows:
 * `headword\treading\tlemma\tpos\tdefinition\texample[\tfrequencyRank]`
 */
export function parseTsvDictionary(text: string, languageTag: string): ParsedDictionaryEntry[] {
  const entries: ParsedDictionaryEntry[] = [];
  const lines = text.split(/\r?\n/);
  let sawFirstDataRow = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const cols = rawLine.split("\t");
    const headword = cols[0]?.trim() ?? "";
    const reading = cols[1]?.trim() || undefined;
    const lemma = cols[2]?.trim() || undefined;
    const pos = cols[3]?.trim() || undefined;
    const definition = cols[4]?.trim() ?? "";
    const example = cols[5]?.trim() || undefined;
    const freqCol = cols[6]?.trim();

    if (!sawFirstDataRow) {
      sawFirstDataRow = true;
      if (
        headword.toLowerCase() === "headword" &&
        (definition.toLowerCase() === "definition" ||
          (cols[1]?.trim().toLowerCase() ?? "") === "reading")
      ) {
        continue;
      }
    }

    if (!headword || !definition) continue;

    const parsedFreq = freqCol ? Number(freqCol) : Number.NaN;
    const frequencyRank = Number.isFinite(parsedFreq) && parsedFreq > 0 ? parsedFreq : undefined;

    entries.push({
      headword,
      normalizedHeadword: normalizeForLookup(headword, languageTag),
      ...(reading ? { reading } : {}),
      ...(lemma ? { lemma } : {}),
      ...(pos ? { pos } : {}),
      senses: [{ definition }],
      ...(example ? { examples: [example] } : {}),
      ...(frequencyRank !== undefined ? { frequencyRank } : {}),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// StarDict (.ifo + .idx + .dict) parser
// ---------------------------------------------------------------------------

export interface StarDictHeader {
  version?: string;
  bookname?: string;
  wordcount?: number;
  idxfilesize?: number;
  idxoffsetbits: 32 | 64;
  sametypesequence?: string;
  description?: string;
  author?: string;
  website?: string;
}

export function parseStarDictIfo(ifoText: string): StarDictHeader {
  const lines = ifoText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new LanguagePackError("invalid-format", "StarDict .ifo file is empty");
  }

  const kv: Record<string, string> = {};
  for (const line of lines) {
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim().toLowerCase();
    const value = line.slice(eqIndex + 1).trim();
    kv[key] = value;
  }

  const hasMagic = lines[0].toLowerCase().includes("stardict");
  if (!hasMagic && !kv.wordcount && !kv.bookname && !kv.idxfilesize) {
    throw new LanguagePackError("invalid-format", "Missing StarDict .ifo header fields");
  }

  const idxoffsetbits = kv.idxoffsetbits === "64" ? 64 : 32;
  const wordcount = kv.wordcount !== undefined ? Number.parseInt(kv.wordcount, 10) : undefined;
  const idxfilesize = kv.idxfilesize !== undefined ? Number.parseInt(kv.idxfilesize, 10) : undefined;

  return {
    version: kv.version,
    bookname: kv.bookname,
    wordcount: Number.isFinite(wordcount) ? wordcount : undefined,
    idxfilesize: Number.isFinite(idxfilesize) ? idxfilesize : undefined,
    idxoffsetbits,
    sametypesequence: kv.sametypesequence,
    description: kv.description,
    author: kv.author,
    website: kv.website,
  };
}

interface StarDictField {
  type: string;
  text: string;
}

function splitNullTerminatedFields(slice: Uint8Array, types: string): StarDictField[] {
  const fields: StarDictField[] = [];
  let cursor = 0;

  for (let i = 0; i < types.length && cursor <= slice.length; i += 1) {
    const type = types[i];
    const isLast = i === types.length - 1;

    if (type === type.toUpperCase() && type !== type.toLowerCase()) {
      // Media/binary payload prefixed by 4-byte length unless last field.
      if (isLast) {
        cursor = slice.length;
      } else if (cursor + 4 <= slice.length) {
        const view = new DataView(slice.buffer, slice.byteOffset + cursor, 4);
        const len = view.getUint32(0, false);
        cursor = Math.min(slice.length, cursor + 4 + len);
      }
      continue;
    }

    if (isLast) {
      fields.push({ type, text: utf8Decoder.decode(slice.subarray(cursor)).replace(/\0+$/, "") });
      cursor = slice.length;
    } else {
      let end = cursor;
      while (end < slice.length && slice[end] !== 0) end += 1;
      fields.push({ type, text: utf8Decoder.decode(slice.subarray(cursor, end)) });
      cursor = end + 1;
    }
  }
  return fields;
}

function splitUntypedStarDictFields(slice: Uint8Array): StarDictField[] {
  const hasNull = slice.includes(0);
  const firstChar = slice.length > 0 ? String.fromCharCode(slice[0]) : "";
  const secondChar = slice.length > 1 ? String.fromCharCode(slice[1]) : "";
  const looksPrefixedXmlOrHtml =
    (firstChar === "x" || firstChar === "h" || firstChar === "g") && secondChar === "<";

  if (!hasNull && !looksPrefixedXmlOrHtml) {
    const rawText = utf8Decoder.decode(slice);
    const trimmed = rawText.trim();
    const type = trimmed.startsWith("<")
      ? trimmed.includes("<ar>") || trimmed.includes("<k>") || trimmed.includes("<dtrn>")
        ? "x"
        : "h"
      : "m";
    return [{ type, text: rawText }];
  }

  const fields: StarDictField[] = [];
  let cursor = 0;
  while (cursor < slice.length) {
    const type = String.fromCharCode(slice[cursor]);
    cursor += 1;
    if (type === type.toUpperCase() && type !== type.toLowerCase()) {
      if (cursor + 4 > slice.length) break;
      const len = new DataView(slice.buffer, slice.byteOffset + cursor, 4).getUint32(0, false);
      cursor = Math.min(slice.length, cursor + 4 + len);
      continue;
    }
    let end = cursor;
    while (end < slice.length && slice[end] !== 0) end += 1;
    fields.push({ type, text: utf8Decoder.decode(slice.subarray(cursor, end)) });
    cursor = end + 1;
  }
  return fields;
}

function interpretStarDictFields(
  headword: string,
  fields: readonly StarDictField[],
  languageTag: string,
): ParsedDictionaryEntry | null {
  let reading: string | undefined;
  let pos: string | undefined;
  const senses: DictionarySense[] = [];
  const examples: string[] = [];

  for (const field of fields) {
    const raw = field.text.trim();
    if (!raw) continue;

    if (field.type === "t") {
      if (!reading) reading = stripMarkup(raw);
      continue;
    }

    if (field.type === "x") {
      if (!reading) {
        const transcriptions = extractXmlTagTexts(raw, ["tr"]);
        if (transcriptions.length > 0) reading = transcriptions[0];
      }
      if (!pos) {
        const grammarTags = extractXmlTagTexts(raw, ["pos", "gr"]);
        if (grammarTags.length > 0) pos = grammarTags[0];
      }
      examples.push(...extractXmlTagTexts(raw, ["ex"]));

      const defs = extractXmlTagTexts(raw, ["dtrn", "def"]);
      if (defs.length > 0) {
        for (const def of defs) senses.push({ definition: def });
      } else {
        const withoutKey = raw.replace(/<k(?:\s[^>]*)?>[\s\S]*?<\/k>/gi, " ");
        const cleaned = stripMarkup(withoutKey);
        if (cleaned) senses.push({ definition: cleaned });
      }
      continue;
    }

    if (field.type === "h" || field.type === "g") {
      const cleaned = stripMarkup(raw);
      if (cleaned) senses.push({ definition: cleaned });
      continue;
    }

    // Plain text types ('m', 'l', 'y', 'k', 'w', etc.)
    const cleaned = decodeXmlEntities(raw).trim();
    if (cleaned) senses.push({ definition: cleaned });
  }

  if (senses.length === 0) return null;
  const uniqueExamples = uniqueStrings(examples);
  return {
    headword,
    normalizedHeadword: normalizeForLookup(headword, languageTag),
    ...(reading ? { reading } : {}),
    ...(pos ? { pos } : {}),
    senses,
    ...(uniqueExamples.length > 0 ? { examples: uniqueExamples } : {}),
  };
}

/**
 * Parse StarDict `.ifo`, `.idx`, and `.dict` buffers into normalized dictionary entries.
 */
export function parseStarDictFiles(
  files: StarDictInputFiles,
  languageTag: string,
): ParsedDictionaryEntry[] {
  const header = parseStarDictIfo(files.ifo);
  const { idx, dict } = files;
  const offsetByteLen = header.idxoffsetbits === 64 ? 8 : 4;
  const view = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);

  if (header.idxfilesize !== undefined && header.idxfilesize !== idx.length) {
    throw new LanguagePackError(
      "invalid-format",
      `StarDict .idx size mismatch: expected ${header.idxfilesize} bytes, got ${idx.length}`,
    );
  }

  const entries: ParsedDictionaryEntry[] = [];
  let cursor = 0;

  while (cursor < idx.length) {
    let nullPos = cursor;
    while (nullPos < idx.length && idx[nullPos] !== 0) nullPos += 1;
    if (nullPos >= idx.length) {
      throw new LanguagePackError("invalid-format", "Truncated word in StarDict .idx file");
    }

    const headword = utf8Decoder.decode(idx.subarray(cursor, nullPos)).trim();
    cursor = nullPos + 1;

    if (cursor + offsetByteLen + 4 > idx.length) {
      throw new LanguagePackError("invalid-format", "Truncated offset/size tuple in StarDict .idx file");
    }

    let offset: number;
    if (offsetByteLen === 8) {
      const bigOffset = view.getBigUint64(cursor, false);
      offset = Number(bigOffset);
      cursor += 8;
    } else {
      offset = view.getUint32(cursor, false);
      cursor += 4;
    }
    const size = view.getUint32(cursor, false);
    cursor += 4;

    if (offset + size > dict.length) {
      throw new LanguagePackError(
        "invalid-format",
        `StarDict .dict slice out of bounds for "${headword}" (${offset}+${size} > ${dict.length})`,
      );
    }

    if (!headword || size === 0) continue;
    const payload = dict.subarray(offset, offset + size);
    const fields = header.sametypesequence
      ? splitNullTerminatedFields(payload, header.sametypesequence)
      : splitUntypedStarDictFields(payload);

    const parsed = interpretStarDictFields(headword, fields, languageTag);
    if (parsed) entries.push(parsed);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Unified payload parser & format detection
// ---------------------------------------------------------------------------

function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function hasZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

async function maybeDecompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasGzipMagic(bytes)) return bytes;
  const DecompressionStreamCtor = (
    globalThis as unknown as {
      DecompressionStream?: new (format: string) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).DecompressionStream;

  if (!DecompressionStreamCtor) {
    throw new LanguagePackError(
      "unsupported-format",
      "Gzip/dictzip decompression requires DecompressionStream support in this runtime",
    );
  }

  const ds = new DecompressionStreamCtor("gzip");
  const writer = ds.writable.getWriter();
  const cleanCopy = new Uint8Array(bytes.byteLength);
  cleanCopy.set(bytes);
  void writer.write(cleanCopy).then(() => writer.close());

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function parseStarDictZip(
  bytes: Uint8Array,
  languageTag: string,
): Promise<ParsedDictionaryEntry[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new LanguagePackError("invalid-format", `Invalid StarDict ZIP archive: ${String(error)}`);
  }

  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const ifoName = names.find((name) => /\.ifo$/i.test(name));
  const idxName = names.find((name) => /\.idx$/i.test(name));
  const dictName = names.find((name) => /\.dict(?:\.dz)?$/i.test(name));

  if (!ifoName || !idxName || !dictName) {
    throw new LanguagePackError(
      "invalid-format",
      "StarDict ZIP archive must contain .ifo, .idx, and .dict (or .dict.dz) files",
    );
  }

  const [ifo, idx, rawDict] = await Promise.all([
    zip.files[ifoName].async("string"),
    zip.files[idxName].async("uint8array"),
    zip.files[dictName].async("uint8array"),
  ]);
  const dict = await maybeDecompressGzip(rawDict);
  return parseStarDictFiles({ ifo, idx, dict }, languageTag);
}

/** Infer pack format from filename extension or magic bytes. */
export function detectLanguagePackFormat(
  fileName?: string,
  bytes?: Uint8Array,
): LanguagePackFormat | null {
  const lower = fileName?.toLowerCase().trim() ?? "";
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "kaikki-jsonl";
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) return "tsv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".stardict.zip")) return "stardict";
  if (lower.endsWith(".zip")) return "yomichan-zip";

  if (bytes && hasZipMagic(bytes)) return "yomichan-zip";
  return null;
}

/**
 * Parse raw pack bytes in any supported `LanguagePackFormat`.
 */
export async function parseLanguagePackPayload(
  format: LanguagePackFormat,
  bytes: Uint8Array,
  languageTag: string,
): Promise<ParsedDictionaryEntry[]> {
  switch (format) {
    case "yomichan-zip":
      return parseYomichanZip(bytes, languageTag);
    case "stardict":
      if (hasZipMagic(bytes)) {
        return parseStarDictZip(bytes, languageTag);
      }
      throw new LanguagePackError(
        "invalid-format",
        "StarDict single-payload import must be a ZIP containing .ifo, .idx, and .dict; or pass { ifo, idx, dict } to parseStarDictFiles / installStarDictFiles",
      );
    case "json":
      return parseJsonDictionary(utf8Decoder.decode(await maybeDecompressGzip(bytes)), languageTag);
    case "kaikki-jsonl":
      return parseKaikkiJsonl(utf8Decoder.decode(await maybeDecompressGzip(bytes)), languageTag);
    case "tsv":
      return parseTsvDictionary(utf8Decoder.decode(await maybeDecompressGzip(bytes)), languageTag);
    default:
      throw new LanguagePackError("unsupported-format", `Unsupported pack format: ${String(format)}`);
  }
}
