import { normalizeForLookup, scriptMetadata, tokenKind, wordSegments } from "../unicode";
import {
  baseLanguageCode,
  buildChunkFromAnalysis,
  createCapabilityDeclarations,
  createSimpleAdapter,
  resolvePackEntry,
  segmentSentencesMultilingual,
  throwIfAborted,
  type RawTokenInput,
} from "./shared";

export const ARABIC_RTL_ADAPTER_ID = "local-arabic-rtl";
const ARABIC_RTL_ADAPTER_VERSION = "1.0.0";

const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u0640]/gu;
const HEBREW_NIQQUD_RE = /[\u0591-\u05C7]/gu;

/**
 * Strips Arabic diacritics (`\u064B-\u065F\u0670`) and tatweel, and normalizes
 * alef (`أ/إ/آ/ٱ -> ا`), alef-maqsura (`ى -> ي`), and taa-marbuta (`ة -> ه`)
 * without altering the source `surface`.
 */
export function normalizeArabicLookup(value: string, languageTag: string = "ar"): string {
  const base = baseLanguageCode(languageTag);
  const nfc = normalizeForLookup(value, languageTag);
  if (base === "he") {
    return nfc.replace(HEBREW_NIQQUD_RE, "");
  }
  const stripped = nfc.replace(ARABIC_DIACRITICS_RE, "");
  if (base === "ar") {
    return stripped
      .replace(/[أإآٱ]/gu, "ا")
      .replace(/ى/gu, "ي")
      .replace(/ة/gu, "ه");
  }
  // Persian/Urdu: preserve script-native characters while normalizing alef variants
  return stripped.replace(/[أإآٱ]/gu, "ا");
}

const ARABIC_CLOSED_CLASS = new Map<string, string>([
  ["في", "preposition"],
  ["من", "preposition"],
  ["علي", "preposition"],
  ["الي", "preposition"],
  ["عن", "preposition"],
  ["مع", "preposition"],
  ["بين", "preposition"],
  ["عند", "preposition"],
  ["حتي", "preposition"],
  ["هذا", "pronoun"],
  ["هذه", "pronoun"],
  ["ذلك", "pronoun"],
  ["تلك", "pronoun"],
  ["هو", "pronoun"],
  ["هي", "pronoun"],
  ["هم", "pronoun"],
  ["نحن", "pronoun"],
  ["انا", "pronoun"],
  ["انت", "pronoun"],
  ["التي", "pronoun"],
  ["الذي", "pronoun"],
  ["و", "conjunction"],
  ["او", "conjunction"],
  ["ثم", "conjunction"],
  ["لكن", "conjunction"],
  ["بل", "conjunction"],
  ["ان", "particle"],
  ["لا", "particle"],
  ["ما", "particle"],
  ["لم", "particle"],
  ["لن", "particle"],
  ["قد", "particle"],
  ["هل", "particle"],
  ["كيف", "adverb"],
  ["اين", "adverb"],
  ["متي", "adverb"],
  ["كان", "verb"],
  ["كانت", "verb"],
]);

const ARABIC_CORE_LEXICON = new Map<string, { lemma: string; pos: string }>([
  ["كتاب", { lemma: "كتاب", pos: "noun" }],
  ["كتب", { lemma: "كتاب", pos: "noun" }],
  ["قلم", { lemma: "قلم", pos: "noun" }],
  ["بيت", { lemma: "بيت", pos: "noun" }],
  ["باب", { lemma: "باب", pos: "noun" }],
  ["ولد", { lemma: "ولد", pos: "noun" }],
  ["يوم", { lemma: "يوم", pos: "noun" }],
  ["ليل", { lemma: "ليل", pos: "noun" }],
  ["علم", { lemma: "علم", pos: "noun" }],
  ["مدرسه", { lemma: "مدرسة", pos: "noun" }],
  ["شمس", { lemma: "شمس", pos: "noun" }],
  ["قمر", { lemma: "قمر", pos: "noun" }],
  ["ماء", { lemma: "ماء", pos: "noun" }],
  ["عربيه", { lemma: "عربية", pos: "noun" }],
  ["لغه", { lemma: "لغة", pos: "noun" }],
  ["سفر", { lemma: "سفر", pos: "noun" }],
  ["مكتبه", { lemma: "مكتبة", pos: "noun" }],
  ["طالب", { lemma: "طالب", pos: "noun" }],
  ["استاذ", { lemma: "أستاذ", pos: "noun" }],
  ["سلام", { lemma: "سلام", pos: "noun" }],
  ["مرحبا", { lemma: "مرحبا", pos: "interjection" }],
  ["حالك", { lemma: "حال", pos: "noun" }],
  ["حال", { lemma: "حال", pos: "noun" }],
  ["بخير", { lemma: "خير", pos: "noun" }],
  ["خير", { lemma: "خير", pos: "noun" }],
]);

const COMPOUND_PROCLITICS = ["وال", "بال", "كال", "فال", "لل", "ال"] as const;
const SINGLE_PROCLITICS = ["و", "ف", "ب", "ل", "ك"] as const;
const ENCLITICS = ["كما", "هم", "هن", "كم", "كن", "نا", "ها", "ه", "ي"] as const;

interface CliticAnalysis {
  lemma: string;
  pos?: string;
  proclitic?: string;
  enclitic?: string;
  confidence: number;
}

function analyzeArabicClitics(normalized: string): CliticAnalysis {
  const closedPos = ARABIC_CLOSED_CLASS.get(normalized);
  if (closedPos) {
    return { lemma: normalized, pos: closedPos, confidence: 0.92 };
  }
  const directCore = ARABIC_CORE_LEXICON.get(normalized);
  if (directCore) {
    return { lemma: directCore.lemma, pos: directCore.pos, confidence: 0.92 };
  }

  let stem = normalized;
  let proclitic: string | undefined;
  let enclitic: string | undefined;
  let conf = 0.8;

  // 1. Strip compound proclitic + definite article (ال, وال, بال, كال, فال, لل)
  for (const prefix of COMPOUND_PROCLITICS) {
    if (stem.startsWith(prefix) && stem.length - prefix.length >= 3) {
      proclitic = prefix;
      stem = stem.slice(prefix.length);
      conf = ARABIC_CORE_LEXICON.has(stem) ? 0.88 : 0.78;
      break;
    }
  }

  // 2. Conservative single-letter proclitic stripping (و, ف, ب, ل, ك)
  if (!proclitic) {
    for (const prefix of SINGLE_PROCLITICS) {
      if (!stem.startsWith(prefix)) continue;
      const candidate = stem.slice(1);
      if (ARABIC_CORE_LEXICON.has(candidate)) {
        proclitic = prefix;
        stem = candidate;
        conf = 0.84;
        break;
      }
      if (candidate.length >= 4) {
        proclitic = prefix;
        stem = candidate;
        conf = 0.68;
        break;
      }
    }
  }

  // 3. Conservative enclitic pronoun stripping
  for (const suffix of ENCLITICS) {
    if (!stem.endsWith(suffix)) continue;
    const candidate = stem.slice(0, -suffix.length);
    if (candidate.length < 3) continue;
    const restoredTaa = candidate.endsWith("ت") ? `${candidate.slice(0, -1)}ه` : candidate;
    if (ARABIC_CORE_LEXICON.has(candidate) || ARABIC_CORE_LEXICON.has(restoredTaa)) {
      enclitic = suffix;
      stem = ARABIC_CORE_LEXICON.has(restoredTaa) ? restoredTaa : candidate;
      conf = Math.min(conf, 0.82);
      break;
    }
    if (candidate.length >= 4 && suffix.length >= 2) {
      enclitic = suffix;
      stem = restoredTaa;
      conf = Math.min(conf, 0.68);
      break;
    }
  }

  const core = ARABIC_CORE_LEXICON.get(stem);
  return {
    lemma: core?.lemma ?? stem,
    pos: core?.pos,
    proclitic,
    enclitic,
    confidence: core ? Math.max(conf, 0.84) : conf,
  };
}

export const arabicRtlAdapter = createSimpleAdapter({
  id: ARABIC_RTL_ADAPTER_ID,
  version: ARABIC_RTL_ADAPTER_VERSION,
  supportedLanguageTags: ["ar", "he", "fa", "ur"],
  capabilities: createCapabilityDeclarations({
    sentenceSegment: 0.96,
    tokenize: 0.95,
    normalize: 0.98,
    lemma: 0.78,
    pos: 0.76,
    morphology: 0.78,
    script: 0.99,
  }),
  privacyDisclosure:
    "Runs locally on this device with diacritic-preserving RTL tokenization, Arabic letter normalization, and conservative clitic stripping. No text leaves the device.",
  async analyze(request, languageTag, manifest, signal) {
    const base = baseLanguageCode(languageTag);
    const sentenceParts = segmentSentencesMultilingual(request.text, String(languageTag));
    const segments = wordSegments(request.text, String(languageTag));
    const rawTokens: RawTokenInput[] = [];

    for (const part of segments) {
      throwIfAborted(signal, ARABIC_RTL_ADAPTER_ID);
      const kind = tokenKind(part.segment, part.isWordLike);
      const normalized = normalizeArabicLookup(part.segment, String(languageTag));
      const script = scriptMetadata(part.segment);

      if (kind !== "word") {
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          script,
          confidenceScore: 0.98,
        });
        continue;
      }

      const features: Record<string, string> = {
        direction: script.direction,
      };
      if (ARABIC_DIACRITICS_RE.test(part.segment) || HEBREW_NIQQUD_RE.test(part.segment)) {
        ARABIC_DIACRITICS_RE.lastIndex = 0;
        HEBREW_NIQQUD_RE.lastIndex = 0;
        features.hasDiacritics = "true";
      }

      const pack = await resolvePackEntry(part.segment, normalized, String(languageTag));
      if (pack && (pack.lemma || pack.pos)) {
        if (pack.morphology) Object.assign(features, pack.morphology);
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: pack.lemma ?? normalized,
          pos: pack.pos,
          morphology: { features },
          script,
          confidenceScore: pack.confidence ?? 0.92,
        });
        continue;
      }

      if (base === "ar") {
        const analysis = analyzeArabicClitics(normalized);
        if (analysis.proclitic) features.proclitic = analysis.proclitic;
        if (analysis.enclitic) features.enclitic = analysis.enclitic;
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: analysis.lemma,
          pos: analysis.pos,
          morphology: {
            features,
            isPartial: Boolean(analysis.proclitic || analysis.enclitic),
          },
          script,
          confidenceScore: analysis.confidence,
        });
      } else {
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: normalized,
          morphology: { features },
          script,
          confidenceScore: 0.82,
        });
      }
    }

    return buildChunkFromAnalysis({
      adapterId: ARABIC_RTL_ADAPTER_ID,
      adapterVersion: ARABIC_RTL_ADAPTER_VERSION,
      manifest,
      request,
      languageTag,
      sentenceParts,
      rawTokens,
    });
  },
});
