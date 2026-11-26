import { normalizeForLookup, tokenKind, wordSegments } from "../unicode";
import {
  buildChunkFromAnalysis,
  createCapabilityDeclarations,
  createSimpleAdapter,
  resolvePackEntry,
  segmentSentencesMultilingual,
  throwIfAborted,
  type RawTokenInput,
} from "./shared";

export const KOREAN_ADAPTER_ID = "local-korean";
const KOREAN_ADAPTER_VERSION = "1.0.0";

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const MEDIAL_COUNT = 21;
const FINAL_COUNT = 28;

const CHOSEONG_JAMO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const JUNGSEONG_JAMO = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
] as const;

const JONGSEONG_JAMO = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;

const RR_INITIAL = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
] as const;

const RR_MEDIAL = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa",
  "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
] as const;

const RR_FINAL = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "l",
  "l", "l", "l", "l", "l", "l", "m", "p", "p", "t",
  "t", "ng", "t", "t", "k", "t", "p", "t",
] as const;

const RR_LIAISON: Readonly<Record<number, string>> = {
  1: "g", 2: "kk", 4: "n", 7: "d", 8: "r", 16: "m", 17: "b",
  19: "s", 20: "ss", 22: "j", 23: "ch", 24: "k", 25: "t", 26: "p", 27: "",
};

export interface HangulJamoIndices {
  initial: number;
  medial: number;
  final: number;
}

export function decomposeHangulSyllable(syllable: string): HangulJamoIndices | null {
  if (syllable.length !== 1) return null;
  const code = syllable.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_END) return null;
  const offset = code - HANGUL_BASE;
  const final = offset % FINAL_COUNT;
  const medial = Math.floor(offset / FINAL_COUNT) % MEDIAL_COUNT;
  const initial = Math.floor(offset / (MEDIAL_COUNT * FINAL_COUNT));
  return { initial, medial, final };
}

export function composeHangulSyllable(initial: number, medial: number, final = 0): string {
  const code = HANGUL_BASE + (initial * MEDIAL_COUNT + medial) * FINAL_COUNT + final;
  return String.fromCharCode(code);
}

export function decomposeHangul(value: string): string {
  let out = "";
  for (const ch of value) {
    const parts = decomposeHangulSyllable(ch);
    if (!parts) {
      out += ch;
    } else {
      out += CHOSEONG_JAMO[parts.initial] + JUNGSEONG_JAMO[parts.medial] + JONGSEONG_JAMO[parts.final];
    }
  }
  return out;
}

export function composeHangul(jamo: string): string {
  let out = "";
  let i = 0;
  while (i < jamo.length) {
    const l = CHOSEONG_JAMO.indexOf(jamo[i] as (typeof CHOSEONG_JAMO)[number]);
    const v = i + 1 < jamo.length ? JUNGSEONG_JAMO.indexOf(jamo[i + 1] as (typeof JUNGSEONG_JAMO)[number]) : -1;
    if (l !== -1 && v !== -1) {
      let t = 0;
      let step = 2;
      if (i + 2 < jamo.length) {
        const candidateT = JONGSEONG_JAMO.indexOf(jamo[i + 2] as (typeof JONGSEONG_JAMO)[number]);
        const nextV = i + 3 < jamo.length ? JUNGSEONG_JAMO.indexOf(jamo[i + 3] as (typeof JUNGSEONG_JAMO)[number]) : -1;
        if (candidateT > 0 && nextV === -1) {
          t = candidateT;
          step = 3;
        }
      }
      out += composeHangulSyllable(l, v, t);
      i += step;
    } else {
      out += jamo[i];
      i += 1;
    }
  }
  return out;
}

/** Revised Romanization of Korean with basic intervocalic coda liaison. */
export function romanizeKorean(value: string): string {
  const chars = [...value];
  let out = "";
  let carryOnset = "";
  for (let i = 0; i < chars.length; i += 1) {
    const parts = decomposeHangulSyllable(chars[i]);
    if (!parts) {
      out += carryOnset + chars[i];
      carryOnset = "";
      continue;
    }
    const onset = parts.initial === 11 && carryOnset ? carryOnset : RR_INITIAL[parts.initial];
    carryOnset = "";
    const vowel = RR_MEDIAL[parts.medial];
    const nextParts = i + 1 < chars.length ? decomposeHangulSyllable(chars[i + 1]) : null;
    let coda = "";
    if (parts.final > 0) {
      if (nextParts && nextParts.initial === 11 && parts.final !== 21 && RR_LIAISON[parts.final] !== undefined) {
        carryOnset = RR_LIAISON[parts.final];
      } else {
        coda = RR_FINAL[parts.final];
      }
    }
    out += `${onset}${vowel}${coda}`;
  }
  return out + carryOnset;
}

const KNOWN_VERBS = new Set([
  "먹다", "가다", "오다", "보다", "하다", "자다", "주다", "쓰다", "읽다", "듣다",
  "걷다", "살다", "알다", "만나다", "배우다", "마시다", "사다", "팔다", "열다", "닫다",
  "찾다", "앉다", "서다", "웃다", "울다", "돕다", "공부하다", "사랑하다", "일하다", "기다리다",
]);

const KNOWN_ADJECTIVES = new Set([
  "좋다", "크다", "작다", "많다", "적다", "높다", "낮다", "길다", "짧다", "넓다",
  "좁다", "예쁘다", "바쁘다", "아프다", "기쁘다", "슬프다", "춥다", "덥다", "어렵다",
  "쉽다", "새롭다", "맛있다", "재미있다", "없다", "있다",
]);

const KNOWN_NOUNS_PRONOUNS = new Map<string, string>([
  ["나", "pronoun"], ["너", "pronoun"], ["저", "pronoun"], ["우리", "pronoun"],
  ["집", "noun"], ["밥", "noun"], ["학교", "noun"], ["친구", "noun"], ["날씨", "noun"],
  ["한국", "noun"], ["한국어", "noun"], ["서울", "noun"], ["책", "noun"], ["물", "noun"],
  ["시간", "noun"], ["사람", "noun"], ["아이", "noun"], ["어머니", "noun"], ["아버지", "noun"],
  ["공부", "noun"], ["사랑", "noun"],
]);

interface DeinflectKoreanResult {
  lemma: string;
  pos: string;
  features: Record<string, string>;
  confidence: number;
}

function posForPredicate(lemma: string): { pos: string; known: boolean } {
  if (KNOWN_ADJECTIVES.has(lemma)) return { pos: "adjective", known: true };
  if (KNOWN_VERBS.has(lemma)) return { pos: "verb", known: true };
  return { pos: "verb", known: false };
}

function uncontractStem(stemLast: string, wasPast: boolean): string[] {
  const parts = decomposeHangulSyllable(stemLast);
  if (!parts) return [stemLast];
  const candidates: string[] = [];
  const final = wasPast && parts.final === 20 ? 0 : parts.final; // strip ㅆ past marker

  if (parts.medial === 0 && final === 0) {
    // ㅏ -> ㅏ (가다, 자다, 사다)
    candidates.push(composeHangulSyllable(parts.initial, 0, 0));
  } else if (parts.medial === 9 && final === 0) {
    // ㅘ -> ㅗ (보다, 오다)
    candidates.push(composeHangulSyllable(parts.initial, 8, 0));
  } else if (parts.medial === 14 && final === 0) {
    // ㅝ -> ㅜ (주다, 배우다) or ㅂ-irregular (춥다, 덥다, 어렵다, 쉽다)
    candidates.push(composeHangulSyllable(parts.initial, 13, 0));
  } else if (parts.medial === 1 && parts.initial === 18 && final === 0) {
    // 했 -> 하 (하다)
    candidates.push("하");
  } else if (parts.medial === 6 && final === 0) {
    // ㅕ -> ㅣ (마시다, 기다리다)
    candidates.push(composeHangulSyllable(parts.initial, 20, 0));
  } else if (parts.medial === 4 && final === 0) {
    // ㅓ -> ㅡ (쓰다, 크다, 예쁘다, 바쁘다) or ㅓ (서다)
    candidates.push(composeHangulSyllable(parts.initial, 18, 0));
    candidates.push(composeHangulSyllable(parts.initial, 4, 0));
  }
  return candidates;
}

function deinflectKoreanPredicate(surface: string): DeinflectKoreanResult | null {
  if (KNOWN_VERBS.has(surface) || KNOWN_ADJECTIVES.has(surface)) {
    const { pos } = posForPredicate(surface);
    return { lemma: surface, pos, features: { verbForm: "dictionary" }, confidence: 0.94 };
  }

  // Formal polite past / present: -었습니다 / -았습니다 / -였습니다 / -했습니다 / -습니다 / -ㅂ니다
  const formalPatterns: readonly [string, boolean, Record<string, string>][] = [
    ["했습니다", true, { tense: "past", politeness: "formal-polite" }],
    ["었습니다", true, { tense: "past", politeness: "formal-polite" }],
    ["았습니다", true, { tense: "past", politeness: "formal-polite" }],
    ["였습니다", true, { tense: "past", politeness: "formal-polite" }],
    ["습니다", false, { tense: "present", politeness: "formal-polite" }],
  ];
  for (const [suffix, isHaOrPast, features] of formalPatterns) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const stem = surface.slice(0, -suffix.length);
      if (suffix === "했습니다") {
        const lemma = `${stem}하다`;
        const { pos, known } = posForPredicate(lemma);
        return { lemma, pos, features: { ...features }, confidence: known ? 0.94 : 0.86 };
      }
      if (suffix === "습니다" && isHaOrPast === false) {
        const lemma = `${stem}다`;
        const { pos, known } = posForPredicate(lemma);
        return { lemma, pos, features: { ...features }, confidence: known ? 0.94 : 0.84 };
      }
      const lemma = `${stem}다`;
      const { pos, known } = posForPredicate(lemma);
      return { lemma, pos, features: { ...features }, confidence: known ? 0.94 : 0.84 };
    }
  }

  // -ㅂ니다 (e.g. 갑니다 -> 가다, 합니다 -> 하다)
  if (surface.endsWith("니다") && surface.length >= 2) {
    const prevIdx = surface.length - 3;
    const parts = prevIdx >= 0 ? decomposeHangulSyllable(surface[prevIdx]) : null;
    if (parts && parts.final === 17) {
      const stem = surface.slice(0, prevIdx) + composeHangulSyllable(parts.initial, parts.medial, 0);
      const lemma = `${stem}다`;
      const { pos, known } = posForPredicate(lemma);
      return {
        lemma,
        pos,
        features: { tense: "present", politeness: "formal-polite" },
        confidence: known ? 0.94 : 0.84,
      };
    }
  }

  // Polite informal (-었어요 / -았어요 / -였어요 / -했어요 / -어요 / -아요 / -해요)
  const politePastSuffixes: readonly [string, Record<string, string>][] = [
    ["했어요", { tense: "past", politeness: "polite" }],
    ["였어요", { tense: "past", politeness: "polite" }],
    ["었어요", { tense: "past", politeness: "polite" }],
    ["았어요", { tense: "past", politeness: "polite" }],
  ];
  for (const [suffix, features] of politePastSuffixes) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const stem = surface.slice(0, -suffix.length);
      if (suffix === "했어요") {
        const lemma = `${stem}하다`;
        const { pos, known } = posForPredicate(lemma);
        return { lemma, pos, features: { ...features }, confidence: known ? 0.94 : 0.86 };
      }
      if (stem.endsWith("우") || stem.endsWith("오")) {
        // ㅂ-irregular e.g. 도왔어요 -> 돕다, 추웠어요 -> 춥다
        const last = decomposeHangulSyllable(stem[stem.length - 1]);
        if (last && stem.length >= 2) {
          const prev = decomposeHangulSyllable(stem[stem.length - 2]);
          if (prev && prev.final === 0) {
            const pIrreg = `${stem.slice(0, -2)}${composeHangulSyllable(prev.initial, prev.medial, 17)}다`;
            if (KNOWN_ADJECTIVES.has(pIrreg) || KNOWN_VERBS.has(pIrreg)) {
              const { pos } = posForPredicate(pIrreg);
              return { lemma: pIrreg, pos, features: { ...features }, confidence: 0.92 };
            }
          }
        }
      }
      const lemma = `${stem}다`;
      const { pos, known } = posForPredicate(lemma);
      return { lemma, pos, features: { ...features }, confidence: known ? 0.94 : 0.84 };
    }
  }

  // Contracted past (-ㅆ어요: 갔어요 -> 가다, 봤어요 -> 보다, 왔어요 -> 오다)
  if ((surface.endsWith("어요") || surface.endsWith("아요")) && surface.length >= 3) {
    const beforeYo = surface.slice(0, -2);
    const lastChar = beforeYo[beforeYo.length - 1];
    const lastParts = decomposeHangulSyllable(lastChar);
    if (lastParts && lastParts.final === 20) {
      const prefix = beforeYo.slice(0, -1);
      for (const uncontracted of uncontractStem(lastChar, true)) {
        const lemma = `${prefix}${uncontracted}다`;
        const { pos, known } = posForPredicate(lemma);
        if (known || uncontractStem(lastChar, true).length === 1) {
          return {
            lemma,
            pos,
            features: { tense: "past", politeness: "polite" },
            confidence: known ? 0.94 : 0.82,
          };
        }
      }
    }
  }

  // Polite present (-해요 / -어요 / -아요 / -요)
  if (surface.endsWith("해요") && surface.length > 2) {
    const lemma = `${surface.slice(0, -2)}하다`;
    const { pos, known } = posForPredicate(lemma);
    return { lemma, pos, features: { tense: "present", politeness: "polite" }, confidence: known ? 0.94 : 0.86 };
  }
  if ((surface.endsWith("어요") || surface.endsWith("아요")) && surface.length > 2) {
    const stem = surface.slice(0, -2);
    // ㅂ-irregular (추워요 -> 춥다, 어려워요 -> 어렵다)
    if (stem.endsWith("워") && stem.length >= 2) {
      const prev = decomposeHangulSyllable(stem[stem.length - 2]);
      if (prev && prev.final === 0) {
        const pIrreg = `${stem.slice(0, -2)}${composeHangulSyllable(prev.initial, prev.medial, 17)}다`;
        if (KNOWN_ADJECTIVES.has(pIrreg) || KNOWN_VERBS.has(pIrreg)) {
          const { pos } = posForPredicate(pIrreg);
          return { lemma: pIrreg, pos, features: { tense: "present", politeness: "polite" }, confidence: 0.92 };
        }
      }
    }
    // ㄷ-irregular (걸어요 -> 걷다, 들어요 -> 듣다)
    if (stem.length >= 1) {
      const last = decomposeHangulSyllable(stem[stem.length - 1]);
      if (last && last.final === 8) {
        const dIrreg = `${stem.slice(0, -1)}${composeHangulSyllable(last.initial, last.medial, 7)}다`;
        if (KNOWN_VERBS.has(dIrreg)) {
          return { lemma: dIrreg, pos: "verb", features: { tense: "present", politeness: "polite" }, confidence: 0.92 };
        }
      }
    }
    const lemma = `${stem}다`;
    const { pos, known } = posForPredicate(lemma);
    return { lemma, pos, features: { tense: "present", politeness: "polite" }, confidence: known ? 0.94 : 0.82 };
  }
  if (surface.endsWith("요") && surface.length >= 2) {
    const beforeYo = surface.slice(0, -1);
    const lastChar = beforeYo[beforeYo.length - 1];
    const prefix = beforeYo.slice(0, -1);
    for (const uncontracted of uncontractStem(lastChar, false)) {
      const lemma = `${prefix}${uncontracted}다`;
      const { pos, known } = posForPredicate(lemma);
      if (known) {
        return { lemma, pos, features: { tense: "present", politeness: "polite" }, confidence: 0.92 };
      }
    }
  }

  // Connective & plain endings (-고, -지만, -면, -으면, -지)
  for (const [suffix, features] of [
    ["지만", { conjunctive: "contrast" }],
    ["으면", { conjunctive: "conditional" }],
    ["면", { conjunctive: "conditional" }],
    ["고", { conjunctive: "coordinate" }],
    ["지", { verbForm: "negative-stem" }],
  ] as const) {
    if (surface.endsWith(suffix) && surface.length > suffix.length) {
      const stem = surface.slice(0, -suffix.length);
      const lemma = `${stem}다`;
      const { pos, known } = posForPredicate(lemma);
      if (known || suffix === "고" || suffix === "지만") {
        return { lemma, pos, features: { ...features }, confidence: known ? 0.92 : 0.78 };
      }
    }
  }

  return null;
}

interface ParticleRule {
  particle: string;
  codaRule: "coda" | "no-coda" | "coda-not-l" | "no-coda-or-l" | "any";
}

const PARTICLE_RULES: readonly ParticleRule[] = [
  { particle: "에서", codaRule: "any" },
  { particle: "으로", codaRule: "coda-not-l" },
  { particle: "은", codaRule: "coda" },
  { particle: "는", codaRule: "no-coda" },
  { particle: "이", codaRule: "coda" },
  { particle: "가", codaRule: "no-coda" },
  { particle: "을", codaRule: "coda" },
  { particle: "를", codaRule: "no-coda" },
  { particle: "과", codaRule: "coda" },
  { particle: "와", codaRule: "no-coda" },
  { particle: "로", codaRule: "no-coda-or-l" },
  { particle: "에", codaRule: "any" },
  { particle: "도", codaRule: "any" },
  { particle: "만", codaRule: "any" },
  { particle: "의", codaRule: "any" },
];

function stripKoreanParticle(surface: string): { stem: string; particle: string; pos: string; confidence: number } | null {
  if (KNOWN_NOUNS_PRONOUNS.has(surface)) return null;
  for (const rule of PARTICLE_RULES) {
    if (!surface.endsWith(rule.particle) || surface.length <= rule.particle.length) continue;
    const stem = surface.slice(0, -rule.particle.length);
    const lastParts = decomposeHangulSyllable(stem[stem.length - 1]);
    if (!lastParts) continue;
    const hasCoda = lastParts.final !== 0;
    const isL = lastParts.final === 8;
    if (rule.codaRule === "coda" && !hasCoda) continue;
    if (rule.codaRule === "no-coda" && hasCoda) continue;
    if (rule.codaRule === "coda-not-l" && (!hasCoda || isL)) continue;
    if (rule.codaRule === "no-coda-or-l" && hasCoda && !isL) continue;

    const knownPos = KNOWN_NOUNS_PRONOUNS.get(stem);
    return {
      stem,
      particle: rule.particle,
      pos: knownPos ?? "noun",
      confidence: knownPos ? 0.92 : 0.78,
    };
  }
  return null;
}

export const koreanAdapter = createSimpleAdapter({
  id: KOREAN_ADAPTER_ID,
  version: KOREAN_ADAPTER_VERSION,
  supportedLanguageTags: ["ko"],
  capabilities: createCapabilityDeclarations({
    sentenceSegment: 0.96,
    tokenize: 0.94,
    normalize: 0.98,
    lemma: 0.85,
    pos: 0.82,
    morphology: 0.84,
    transliteration: 0.9,
    script: 0.99,
  }),
  privacyDisclosure:
    "Runs locally on this device using Hangul Jamo decomposition, particle stripping, predicate deinflection, and Revised Romanization. No text leaves the device.",
  async analyze(request, languageTag, manifest, signal) {
    const sentenceParts = segmentSentencesMultilingual(request.text, String(languageTag));
    const segments = wordSegments(request.text, String(languageTag));
    const rawTokens: RawTokenInput[] = [];

    for (const part of segments) {
      throwIfAborted(signal, KOREAN_ADAPTER_ID);
      const kind = tokenKind(part.segment, part.isWordLike);
      const normalized = normalizeForLookup(part.segment, languageTag);
      if (kind !== "word") {
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          confidenceScore: 0.98,
        });
        continue;
      }

      const romanization = /[\uac00-\ud7a3]/u.test(part.segment) ? romanizeKorean(part.segment) : undefined;
      const features: Record<string, string> = {};
      if (romanization) features.romanization = romanization;

      const pack = await resolvePackEntry(part.segment, normalized, String(languageTag));
      if (pack && (pack.lemma || pack.pos)) {
        if (pack.transliteration) features.romanization = pack.transliteration;
        if (pack.morphology) Object.assign(features, pack.morphology);
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: pack.lemma ?? normalized,
          pos: pack.pos,
          morphology: Object.keys(features).length > 0 ? { features } : undefined,
          confidenceScore: pack.confidence ?? 0.95,
        });
        continue;
      }

      const predicate = deinflectKoreanPredicate(part.segment);
      if (predicate) {
        Object.assign(features, predicate.features);
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: predicate.lemma,
          pos: predicate.pos,
          morphology: { features },
          confidenceScore: predicate.confidence,
        });
        continue;
      }

      const stripped = stripKoreanParticle(part.segment);
      if (stripped) {
        features.particle = stripped.particle;
        features.stem = stripped.stem;
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: stripped.stem,
          pos: stripped.pos,
          morphology: { features },
          confidenceScore: stripped.confidence,
        });
        continue;
      }

      const knownPos = KNOWN_NOUNS_PRONOUNS.get(part.segment);
      rawTokens.push({
        start: part.start,
        end: part.end,
        surface: part.segment,
        kind,
        normalized,
        lemma: part.segment,
        pos: knownPos ?? "noun",
        morphology: Object.keys(features).length > 0 ? { features } : undefined,
        confidenceScore: knownPos ? 0.92 : 0.78,
      });
    }

    return buildChunkFromAnalysis({
      adapterId: KOREAN_ADAPTER_ID,
      adapterVersion: KOREAN_ADAPTER_VERSION,
      manifest,
      request,
      languageTag,
      sentenceParts,
      rawTokens,
    });
  },
});
