import { normalizeForLookup, tokenKind, wordSegments, type TextSegment } from "../unicode";
import {
  buildChunkFromAnalysis,
  createCapabilityDeclarations,
  createSimpleAdapter,
  getLanguageAdapterPackResolver,
  resolvePackEntry,
  resolvePackSegments,
  segmentSentencesMultilingual,
  throwIfAborted,
  type RawTokenInput,
} from "./shared";

export const JAPANESE_ADAPTER_ID = "local-japanese";
const JAPANESE_ADAPTER_VERSION = "1.0.0";

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = KATAKANA_START - HIRAGANA_START;

/** Convert Hiragana characters to Katakana, leaving non-Hiragana intact. */
export function hiraganaToKatakana(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code >= HIRAGANA_START && code <= HIRAGANA_END) {
      out += String.fromCodePoint(code + KANA_OFFSET);
    } else if (ch === "ゝ") {
      out += "ヽ";
    } else if (ch === "ゞ") {
      out += "ヾ";
    } else {
      out += ch;
    }
  }
  return out;
}

/** Convert Katakana characters to Hiragana, leaving non-Katakana intact. */
export function katakanaToHiragana(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (code >= KATAKANA_START && code <= KATAKANA_END) {
      out += String.fromCodePoint(code - KANA_OFFSET);
    } else if (ch === "ヽ") {
      out += "ゝ";
    } else if (ch === "ヾ") {
      out += "ゞ";
    } else {
      out += ch;
    }
  }
  return out;
}

export function detectJapaneseScriptDetail(value: string): string {
  const hasKanji = /[\u4e00-\u9faf\u3400-\u4dbf々]/u.test(value);
  const hasHiragana = /[\u3040-\u309f]/u.test(value);
  const hasKatakana = /[\u30a0-\u30ff]/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);
  if (hasKanji && (hasHiragana || hasKatakana)) return "kanji-kana";
  if (hasKanji) return "kanji";
  if (hasHiragana && hasKatakana) return "mixed-kana";
  if (hasHiragana) return "hiragana";
  if (hasKatakana) return "katakana";
  if (hasLatin) return "latin";
  return "other";
}

function isJapaneseContent(value: string): boolean {
  return /[\u3040-\u30ff\u4e00-\u9faf\u3400-\u4dbf々]/u.test(value);
}

const PARTICLES = new Set([
  "は", "が", "を", "に", "へ", "で", "と", "も", "の", "や", "か", "ね", "よ", "わ",
  "から", "まで", "より", "だけ", "ほど", "など", "ので", "のに", "けれど", "けど",
]);

interface CoreEntry {
  lemma: string;
  pos: string;
  reading: string;
}

const CORE_WORDS: Readonly<Record<string, CoreEntry>> = {
  日本語: { lemma: "日本語", pos: "noun", reading: "にほんご" },
  日本: { lemma: "日本", pos: "noun", reading: "にほん" },
  英語: { lemma: "英語", pos: "noun", reading: "えいご" },
  私: { lemma: "私", pos: "pronoun", reading: "わたし" },
  僕: { lemma: "僕", pos: "pronoun", reading: "ぼく" },
  君: { lemma: "君", pos: "pronoun", reading: "きみ" },
  彼: { lemma: "彼", pos: "pronoun", reading: "かれ" },
  彼女: { lemma: "彼女", pos: "pronoun", reading: "かのじょ" },
  本: { lemma: "本", pos: "noun", reading: "ほん" },
  山: { lemma: "山", pos: "noun", reading: "やま" },
  川: { lemma: "川", pos: "noun", reading: "かわ" },
  水: { lemma: "水", pos: "noun", reading: "みず" },
  火: { lemma: "火", pos: "noun", reading: "ひ" },
  木: { lemma: "木", pos: "noun", reading: "き" },
  人: { lemma: "人", pos: "noun", reading: "ひと" },
  先生: { lemma: "先生", pos: "noun", reading: "せんせい" },
  学生: { lemma: "学生", pos: "noun", reading: "がくせい" },
  学校: { lemma: "学校", pos: "noun", reading: "がっこう" },
  時間: { lemma: "時間", pos: "noun", reading: "じかん" },
  今日: { lemma: "今日", pos: "noun", reading: "きょう" },
  明日: { lemma: "明日", pos: "noun", reading: "あした" },
  昨日: { lemma: "昨日", pos: "noun", reading: "きのう" },
  東京: { lemma: "東京", pos: "noun", reading: "とうきょう" },
  食べる: { lemma: "食べる", pos: "verb", reading: "たべる" },
  読む: { lemma: "読む", pos: "verb", reading: "よむ" },
  書く: { lemma: "書く", pos: "verb", reading: "かく" },
  見る: { lemma: "見る", pos: "verb", reading: "みる" },
  聞く: { lemma: "聞く", pos: "verb", reading: "きく" },
  話す: { lemma: "話す", pos: "verb", reading: "はなす" },
  行く: { lemma: "行く", pos: "verb", reading: "いく" },
  来る: { lemma: "くる", pos: "verb", reading: "くる" },
  くる: { lemma: "くる", pos: "verb", reading: "くる" },
  する: { lemma: "する", pos: "verb", reading: "する" },
  高い: { lemma: "高い", pos: "adjective", reading: "たかい" },
  新しい: { lemma: "新しい", pos: "adjective", reading: "あたらしい" },
  古い: { lemma: "古い", pos: "adjective", reading: "ふるい" },
  大きい: { lemma: "大きい", pos: "adjective", reading: "おおきい" },
  小さい: { lemma: "小さい", pos: "adjective", reading: "ちいさい" },
  良い: { lemma: "良い", pos: "adjective", reading: "よい" },
  いい: { lemma: "いい", pos: "adjective", reading: "いい" },
  ない: { lemma: "ない", pos: "adjective", reading: "ない" },
  です: { lemma: "だ", pos: "auxiliary", reading: "です" },
  ます: { lemma: "ます", pos: "auxiliary", reading: "ます" },
};

const KANJI_VERB_STEM_READINGS: Readonly<Record<string, string>> = {
  食: "た",
  読: "よ",
  書: "か",
  見: "み",
  聞: "き",
  話: "はな",
  行: "い",
  来: "き",
  飲: "の",
  買: "か",
  遊: "あそ",
  待: "ま",
  立: "た",
  帰: "かえ",
  起: "お",
  寝: "ね",
  泳: "およ",
  高: "たか",
  新: "あたら",
  古: "ふる",
  大: "おお",
  小: "ちい",
  良: "よ",
  安: "やす",
  早: "はや",
  遠: "とお",
  近: "ちか",
  勉強: "べんきょう",
};

const IRREGULAR_FORMS: Readonly<Record<string, { lemma: string; pos: string; reading: string; features: Record<string, string> }>> = {
  します: { lemma: "する", pos: "verb", reading: "します", features: { tense: "non-past", politeness: "polite" } },
  しました: { lemma: "する", pos: "verb", reading: "しました", features: { tense: "past", politeness: "polite" } },
  しません: { lemma: "する", pos: "verb", reading: "しません", features: { tense: "non-past", politeness: "polite", polarity: "negative" } },
  しませんでした: { lemma: "する", pos: "verb", reading: "しませんでした", features: { tense: "past", politeness: "polite", polarity: "negative" } },
  して: { lemma: "する", pos: "verb", reading: "して", features: { verbForm: "te-form" } },
  した: { lemma: "する", pos: "verb", reading: "した", features: { tense: "past" } },
  しない: { lemma: "する", pos: "verb", reading: "しない", features: { polarity: "negative" } },
  しなかった: { lemma: "する", pos: "verb", reading: "しなかった", features: { tense: "past", polarity: "negative" } },
  される: { lemma: "する", pos: "verb", reading: "される", features: { voice: "passive" } },
  させる: { lemma: "する", pos: "verb", reading: "させる", features: { voice: "causative" } },
  来ます: { lemma: "くる", pos: "verb", reading: "きます", features: { tense: "non-past", politeness: "polite" } },
  来ました: { lemma: "くる", pos: "verb", reading: "きました", features: { tense: "past", politeness: "polite" } },
  来ません: { lemma: "くる", pos: "verb", reading: "きません", features: { tense: "non-past", politeness: "polite", polarity: "negative" } },
  来て: { lemma: "くる", pos: "verb", reading: "きて", features: { verbForm: "te-form" } },
  来た: { lemma: "くる", pos: "verb", reading: "きた", features: { tense: "past" } },
  来ない: { lemma: "くる", pos: "verb", reading: "こない", features: { polarity: "negative" } },
  来なかった: { lemma: "くる", pos: "verb", reading: "こなかった", features: { tense: "past", polarity: "negative" } },
  きます: { lemma: "くる", pos: "verb", reading: "きます", features: { tense: "non-past", politeness: "polite" } },
  きました: { lemma: "くる", pos: "verb", reading: "きました", features: { tense: "past", politeness: "polite" } },
  きて: { lemma: "くる", pos: "verb", reading: "きて", features: { verbForm: "te-form" } },
  こない: { lemma: "くる", pos: "verb", reading: "こない", features: { polarity: "negative" } },
  行きます: { lemma: "行く", pos: "verb", reading: "いきます", features: { tense: "non-past", politeness: "polite" } },
  行きました: { lemma: "行く", pos: "verb", reading: "いきました", features: { tense: "past", politeness: "polite" } },
  行って: { lemma: "行く", pos: "verb", reading: "いって", features: { verbForm: "te-form" } },
  行った: { lemma: "行く", pos: "verb", reading: "いった", features: { tense: "past" } },
  行かない: { lemma: "行く", pos: "verb", reading: "いかない", features: { polarity: "negative" } },
  良かった: { lemma: "良い", pos: "adjective", reading: "よかった", features: { tense: "past" } },
  よかった: { lemma: "いい", pos: "adjective", reading: "よかった", features: { tense: "past" } },
};

const ICHIDAN_SINGLE_STEMS = new Set(["見", "着", "寝", "出", "い", "み", "き", "ね", "で"]);

const I_ROW_TO_U_ROW: Readonly<Record<string, string>> = {
  き: "く",
  ぎ: "ぐ",
  し: "す",
  ち: "つ",
  に: "ぬ",
  び: "ぶ",
  み: "む",
  り: "る",
  い: "う",
};

const A_ROW_TO_U_ROW: Readonly<Record<string, string>> = {
  か: "く",
  が: "ぐ",
  さ: "す",
  た: "つ",
  な: "ぬ",
  ば: "ぶ",
  ま: "む",
  ら: "る",
  わ: "う",
};

const E_ROW_KANA = new Set(["え", "け", "げ", "せ", "ぜ", "て", "で", "ね", "へ", "べ", "ぺ", "め", "れ"]);

function computeReadingFromStem(surface: string): string | undefined {
  if (/^[\u3040-\u309f]+$/u.test(surface)) return surface;
  if (/^[\u30a0-\u30ff]+$/u.test(surface)) return katakanaToHiragana(surface);
  const core = CORE_WORDS[surface];
  if (core) return core.reading;
  for (const [kanji, reading] of Object.entries(KANJI_VERB_STEM_READINGS)) {
    if (surface.startsWith(kanji)) {
      const rest = surface.slice(kanji.length);
      if (/^[\u3040-\u309f]+$/u.test(rest)) return `${reading}${rest}`;
    }
  }
  return undefined;
}

interface DeinflectionResult {
  lemma: string;
  pos: string;
  reading?: string;
  features: Record<string, string>;
  confidence: number;
}

const POLITE_SUFFIXES: readonly [string, Record<string, string>][] = [
  ["ませんでした", { tense: "past", politeness: "polite", polarity: "negative" }],
  ["ました", { tense: "past", politeness: "polite" }],
  ["ません", { tense: "non-past", politeness: "polite", polarity: "negative" }],
  ["ます", { tense: "non-past", politeness: "polite" }],
  ["たい", { mood: "desiderative" }],
  ["たく", { mood: "desiderative", form: "adverbial" }],
];

function deinflectMasuStem(stem: string, features: Record<string, string>, surface: string): DeinflectionResult | null {
  if (!stem) return null;
  if (stem.endsWith("し") && stem.length >= 2) {
    const nounBase = stem.slice(0, -1);
    return {
      lemma: `${nounBase}する`,
      pos: "verb",
      reading: computeReadingFromStem(surface),
      features,
      confidence: 0.84,
    };
  }
  const last = stem[stem.length - 1];
  if (E_ROW_KANA.has(last) || ICHIDAN_SINGLE_STEMS.has(stem)) {
    return {
      lemma: `${stem}る`,
      pos: "verb",
      reading: computeReadingFromStem(surface),
      features,
      confidence: 0.88,
    };
  }
  const uRow = I_ROW_TO_U_ROW[last];
  if (uRow) {
    return {
      lemma: `${stem.slice(0, -1)}${uRow}`,
      pos: "verb",
      reading: computeReadingFromStem(surface),
      features,
      confidence: 0.86,
    };
  }
  return null;
}

export function deinflectJapanese(surface: string): DeinflectionResult | null {
  const irreg = IRREGULAR_FORMS[surface];
  if (irreg) {
    return {
      lemma: irreg.lemma,
      pos: irreg.pos,
      reading: irreg.reading,
      features: { ...irreg.features },
      confidence: 0.94,
    };
  }

  // Polite verb suffixes (-ました, -ます, -ません, -ませんでした, -たい)
  for (const [suffix, features] of POLITE_SUFFIXES) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const res = deinflectMasuStem(surface.slice(0, -suffix.length), { ...features }, surface);
      if (res) return res;
    }
  }

  // I-adjective inflections (-くなかった, -くない, -かった, -くて, -く)
  const adjRules: readonly [string, Record<string, string>][] = [
    ["くなかった", { tense: "past", polarity: "negative" }],
    ["くない", { tense: "non-past", polarity: "negative" }],
    ["かった", { tense: "past" }],
    ["くて", { verbForm: "te-form" }],
  ];
  for (const [suffix, features] of adjRules) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const stem = surface.slice(0, -suffix.length);
      if (/[\u4e00-\u9faf\u3040-\u309f]$/u.test(stem)) {
        return {
          lemma: `${stem}い`,
          pos: "adjective",
          reading: computeReadingFromStem(surface),
          features: { ...features },
          confidence: 0.86,
        };
      }
    }
  }

  // Negative plain (-なかった, -ない)
  for (const [suffix, features] of [
    ["なかった", { tense: "past", polarity: "negative" }],
    ["ない", { tense: "non-past", polarity: "negative" }],
  ] as const) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const stem = surface.slice(0, -suffix.length);
      const last = stem[stem.length - 1];
      if (E_ROW_KANA.has(last) || ICHIDAN_SINGLE_STEMS.has(stem)) {
        return {
          lemma: `${stem}る`,
          pos: "verb",
          reading: computeReadingFromStem(surface),
          features: { ...features },
          confidence: 0.86,
        };
      }
      const uRow = A_ROW_TO_U_ROW[last];
      if (uRow) {
        return {
          lemma: `${stem.slice(0, -1)}${uRow}`,
          pos: "verb",
          reading: computeReadingFromStem(surface),
          features: { ...features },
          confidence: 0.84,
        };
      }
    }
  }

  // -ている / -ていた progressive
  for (const [suffix, features] of [
    ["ていました", { aspect: "progressive", tense: "past", politeness: "polite" }],
    ["ています", { aspect: "progressive", tense: "non-past", politeness: "polite" }],
    ["ていた", { aspect: "progressive", tense: "past" }],
    ["ている", { aspect: "progressive", tense: "non-past" }],
  ] as const) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const base = deinflectJapanese(`${surface.slice(0, -suffix.length)}て`);
      if (base) {
        return { ...base, reading: computeReadingFromStem(surface), features: { ...features } };
      }
    }
  }

  // Godan & Ichidan te-form / ta-form
  const teTaRules: readonly [string, string, Record<string, string>][] = [
    ["んで", "む", { verbForm: "te-form" }],
    ["んだ", "む", { tense: "past" }],
    ["って", "う", { verbForm: "te-form" }],
    ["った", "う", { tense: "past" }],
    ["いて", "く", { verbForm: "te-form" }],
    ["いた", "く", { tense: "past" }],
    ["いで", "ぐ", { verbForm: "te-form" }],
    ["いだ", "ぐ", { tense: "past" }],
    ["して", "す", { verbForm: "te-form" }],
    ["した", "す", { tense: "past" }],
  ];
  for (const [suffix, defaultEnding, features] of teTaRules) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const stem = surface.slice(0, -suffix.length);
      if (suffix === "んで" || suffix === "んだ") {
        // Prefer known stem dictionary match (e.g. 読 -> 読む)
        const candidates = [`${stem}む`, `${stem}ぶ`, `${stem}ぬ`];
        const matched = candidates.find((c) => CORE_WORDS[c]) ?? `${stem}${defaultEnding}`;
        return {
          lemma: matched,
          pos: "verb",
          reading: computeReadingFromStem(surface),
          features: { ...features },
          confidence: CORE_WORDS[matched] ? 0.9 : 0.78,
        };
      }
      if (suffix === "って" || suffix === "った") {
        const candidates = [`${stem}う`, `${stem}つ`, `${stem}る`];
        const matched = candidates.find((c) => CORE_WORDS[c]) ?? `${stem}${defaultEnding}`;
        return {
          lemma: matched,
          pos: "verb",
          reading: computeReadingFromStem(surface),
          features: { ...features },
          confidence: CORE_WORDS[matched] ? 0.9 : 0.78,
        };
      }
      return {
        lemma: `${stem}${defaultEnding}`,
        pos: "verb",
        reading: computeReadingFromStem(surface),
        features: { ...features },
        confidence: 0.8,
      };
    }
  }

  // Ichidan simple -て / -た
  for (const [suffix, features] of [
    ["て", { verbForm: "te-form" }],
    ["た", { tense: "past" }],
  ] as const) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const stem = surface.slice(0, -suffix.length);
      const last = stem[stem.length - 1];
      if (E_ROW_KANA.has(last) || ICHIDAN_SINGLE_STEMS.has(stem)) {
        return {
          lemma: `${stem}る`,
          pos: "verb",
          reading: computeReadingFromStem(surface),
          features: { ...features },
          confidence: 0.86,
        };
      }
    }
  }

  return null;
}

const NON_INTERNAL_PARTICLES = new Set([
  "は", "が", "を", "へ", "と", "も", "の", "や", "ね", "よ", "わ",
  "から", "まで", "より", "だけ", "ほど", "など", "ので", "のに", "けれど", "けど",
]);

async function mergeJapaneseSegments(
  segments: readonly TextSegment[],
  languageTag: string,
  signal?: AbortSignal,
): Promise<TextSegment[]> {
  const resolver = getLanguageAdapterPackResolver();
  const merged: TextSegment[] = [];
  let index = 0;

  while (index < segments.length) {
    throwIfAborted(signal, JAPANESE_ADAPTER_ID);
    const current = segments[index];
    if (!current.isWordLike || !isJapaneseContent(current.segment) || PARTICLES.has(current.segment)) {
      merged.push(current);
      index += 1;
      continue;
    }

    // 1. Optional pack longest-match enhancement over up to 4 contiguous segments
    let matchedEndIndex = -1;
    if (resolver?.lookupToken) {
      const maxSpan = Math.min(4, segments.length - index);
      for (let span = maxSpan; span >= 2; span -= 1) {
        const candidateParts = segments.slice(index, index + span);
        const contiguous = candidateParts.every(
          (part, idx) =>
            part.isWordLike &&
            (idx === 0 || candidateParts[idx - 1].end === part.start) &&
            !PARTICLES.has(part.segment),
        );
        if (!contiguous) continue;
        const surface = candidateParts.map((p) => p.segment).join("");
        const pack = await resolvePackEntry(surface, normalizeForLookup(surface, languageTag), languageTag);
        if (pack) {
          matchedEndIndex = index + span;
          merged.push({
            start: candidateParts[0].start,
            end: candidateParts[candidateParts.length - 1].end,
            segment: surface,
            isWordLike: true,
          });
          break;
        }
      }
      if (matchedEndIndex !== -1) {
        index = matchedEndIndex;
        continue;
      }
    }

    // 2. Conjugation merger across contiguous Japanese word segments
    let bestSpan = 1;
    const maxLookahead = Math.min(5, segments.length - index);
    for (let span = maxLookahead; span >= 2; span -= 1) {
      const candidateParts = segments.slice(index, index + span);
      const contiguous = candidateParts.every(
        (part, idx) =>
          part.isWordLike &&
          isJapaneseContent(part.segment) &&
          (idx === 0 || (candidateParts[idx - 1].end === part.start && !NON_INTERNAL_PARTICLES.has(part.segment))),
      );
      if (!contiguous) continue;
      const combined = candidateParts.map((p) => p.segment).join("");
      if (CORE_WORDS[combined] || deinflectJapanese(combined)) {
        bestSpan = span;
        break;
      }
    }

    if (bestSpan > 1) {
      const parts = segments.slice(index, index + bestSpan);
      merged.push({
        start: parts[0].start,
        end: parts[parts.length - 1].end,
        segment: parts.map((p) => p.segment).join(""),
        isWordLike: true,
      });
      index += bestSpan;
    } else {
      merged.push(current);
      index += 1;
    }
  }

  return merged;
}

export const japaneseAdapter = createSimpleAdapter({
  id: JAPANESE_ADAPTER_ID,
  version: JAPANESE_ADAPTER_VERSION,
  supportedLanguageTags: ["ja"],
  capabilities: createCapabilityDeclarations({
    sentenceSegment: 0.95,
    tokenize: 0.9,
    normalize: 0.98,
    lemma: 0.84,
    pos: 0.8,
    morphology: 0.82,
    transliteration: 0.85,
    script: 0.99,
  }),
  privacyDisclosure:
    "Runs locally on this device using Intl.Segmenter, Japanese deinflection rules, kana conversion, and optional local pack dictionaries. No text leaves the device.",
  async analyze(request, languageTag, manifest, signal) {
    const sentenceParts = segmentSentencesMultilingual(request.text, String(languageTag));
    const packSegments = await resolvePackSegments(request.text, String(languageTag));
    const baseSegments = packSegments ?? wordSegments(request.text, String(languageTag));
    const segments = packSegments
      ? [...baseSegments]
      : await mergeJapaneseSegments(baseSegments, String(languageTag), signal);

    const rawTokens: RawTokenInput[] = [];
    for (const part of segments) {
      throwIfAborted(signal, JAPANESE_ADAPTER_ID);
      const kind = tokenKind(part.segment, part.isWordLike);
      const normalized = normalizeForLookup(part.segment, languageTag);
      const scriptDetail = detectJapaneseScriptDetail(part.segment);

      if (kind !== "word") {
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          morphology: { features: { scriptDetail } },
          confidenceScore: 0.98,
        });
        continue;
      }

      const features: Record<string, string> = { scriptDetail };
      const pack = await resolvePackEntry(part.segment, normalized, String(languageTag));
      if (pack) {
        if (pack.reading) features.reading = pack.reading;
        if (pack.transliteration) features.transliteration = pack.transliteration;
        if (pack.morphology) Object.assign(features, pack.morphology);
        if (!features.katakana && features.reading) {
          features.katakana = hiraganaToKatakana(features.reading);
        }
        if (scriptDetail === "katakana") {
          features.hiragana = katakanaToHiragana(part.segment);
        }
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: pack.lemma ?? part.segment,
          pos: pack.pos,
          morphology: { features },
          confidenceScore: pack.confidence ?? 0.95,
        });
        continue;
      }

      if (PARTICLES.has(part.segment)) {
        features.reading = part.segment;
        features.katakana = hiraganaToKatakana(part.segment);
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: part.segment,
          pos: "particle",
          morphology: { features },
          confidenceScore: 0.94,
        });
        continue;
      }

      const core = CORE_WORDS[part.segment];
      if (core) {
        features.reading = core.reading;
        features.katakana = hiraganaToKatakana(core.reading);
        if (scriptDetail === "katakana") features.hiragana = katakanaToHiragana(part.segment);
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: core.lemma,
          pos: core.pos,
          morphology: { features },
          confidenceScore: 0.94,
        });
        continue;
      }

      const deinflected = deinflectJapanese(part.segment);
      if (deinflected) {
        Object.assign(features, deinflected.features);
        const reading = deinflected.reading ?? computeReadingFromStem(part.segment);
        if (reading) {
          features.reading = reading;
          features.katakana = hiraganaToKatakana(reading);
        }
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: deinflected.lemma,
          pos: deinflected.pos,
          morphology: { features },
          confidenceScore: deinflected.confidence,
        });
        continue;
      }

      const fallbackReading = computeReadingFromStem(part.segment);
      if (fallbackReading) {
        features.reading = fallbackReading;
        features.katakana = hiraganaToKatakana(fallbackReading);
      } else if (scriptDetail === "hiragana") {
        features.reading = part.segment;
        features.katakana = hiraganaToKatakana(part.segment);
      }
      if (scriptDetail === "katakana") {
        features.hiragana = katakanaToHiragana(part.segment);
      }

      rawTokens.push({
        start: part.start,
        end: part.end,
        surface: part.segment,
        kind,
        normalized,
        lemma: part.segment,
        pos: scriptDetail === "katakana" ? "noun" : "other",
        morphology: { features },
        confidenceScore: fallbackReading ? 0.84 : 0.75,
      });
    }

    return buildChunkFromAnalysis({
      adapterId: JAPANESE_ADAPTER_ID,
      adapterVersion: JAPANESE_ADAPTER_VERSION,
      manifest,
      request,
      languageTag,
      sentenceParts,
      rawTokens,
    });
  },
});
