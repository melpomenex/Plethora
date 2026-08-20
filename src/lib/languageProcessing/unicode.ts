import type {
  Confidence,
  LanguageTag,
  ScriptMetadata,
  ScriptName,
  TextDirection,
  TokenKind,
} from "./types";

/** UTF-16 code-unit length, matching DOM Range and String#slice offsets. */
export function utf16Length(value: string): number {
  return value.length;
}

/**
 * Return a source-safe end for a UTF-16 slice. This prevents an astral code
 * point from being split in the middle; grapheme-aware chunking is exposed
 * separately for callers that also want to preserve combining clusters.
 */
export function safeUtf16End(text: string, proposedEnd: number): number {
  const end = Math.max(0, Math.min(text.length, Math.floor(proposedEnd)));
  if (end > 0 && end < text.length) {
    const previous = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      return end - 1;
    }
  }
  return end;
}

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
}

function segmenter(locale: string, granularity: "grapheme" | "word" | "sentence"): SegmenterLike | null {
  const SegmenterCtor = (Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: string }) => SegmenterLike;
  }).Segmenter;
  if (!SegmenterCtor) return null;
  try {
    return new SegmenterCtor(locale, { granularity });
  } catch {
    return null;
  }
}

/** Grapheme boundaries as UTF-16 offsets; fallback is code-point safe. */
export function graphemeBoundaries(text: string, locale = "und"): number[] {
  const boundaries = [0];
  const intl = segmenter(locale, "grapheme");
  if (intl) {
    for (const part of intl.segment(text)) {
      if (part.index > 0 && part.index < text.length) boundaries.push(part.index);
    }
    boundaries.push(text.length);
    return [...new Set(boundaries)].sort((a, b) => a - b);
  }
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    boundaries.push(index);
  }
  return boundaries;
}

/** Split text into bounded chunks without splitting a grapheme cluster. */
export function splitTextIntoChunks(text: string, maxCodeUnits: number, locale = "und"): Array<{
  text: string;
  start: number;
  end: number;
}> {
  const max = Math.max(1, Math.floor(maxCodeUnits));
  if (text.length === 0) return [{ text: "", start: 0, end: 0 }];
  const boundaries = graphemeBoundaries(text, locale);
  const chunks: Array<{ text: string; start: number; end: number }> = [];
  let startBoundary = 0;
  while (startBoundary < boundaries.length - 1) {
    const start = boundaries[startBoundary];
    let endBoundary = startBoundary + 1;
    while (
      endBoundary < boundaries.length - 1 &&
      boundaries[endBoundary + 1] - start <= max
    ) {
      endBoundary += 1;
    }
    // Prefer a whitespace boundary if one is already inside the bounded span.
    let chosen = endBoundary;
    // When the remaining text already fits, keep the final boundary. The
    // whitespace preference is only for a genuinely bounded chunk; otherwise
    // a short sentence would be needlessly split at its last space.
    if (endBoundary < boundaries.length - 1) {
      for (let candidate = endBoundary; candidate > startBoundary; candidate -= 1) {
        const charBefore = text[boundaries[candidate] - 1] ?? "";
        if (/\s/u.test(charBefore)) {
          chosen = candidate;
          break;
        }
      }
    }
    const end = boundaries[chosen];
    chunks.push({ text: text.slice(start, end), start, end });
    startBoundary = chosen;
  }
  return chunks;
}

export interface TextSegment {
  start: number;
  end: number;
  segment: string;
  isWordLike: boolean;
}

function isLetterOrNumber(value: string): boolean {
  return /[\p{L}\p{M}\p{N}]/u.test(value);
}

function isCjkLike(value: string): boolean {
  const script = scriptMetadata(value).script;
  return script === "han" || script === "hiragana" || script === "katakana" || script === "hangul";
}

function mergeInternalJoiners(text: string, parts: TextSegment[]): TextSegment[] {
  const merged: TextSegment[] = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    const nextIsJoiner = /^[’'\u2010-\u2015-]$/u.test(part.segment);
    if (previous && nextIsJoiner && previous.isWordLike) {
      // The following word is merged on the next iteration only when the
      // joiner is directly adjacent on both sides (spaces keep a hyphen as
      // punctuation rather than changing lexical identity).
      merged.push(part);
      continue;
    }
    const joiner = merged.at(-1);
    const followingWord = part.isWordLike && joiner && /^[’'\u2010-\u2015-]$/u.test(joiner.segment);
    if (followingWord && merged.length >= 2) {
      const beforeJoiner = merged[merged.length - 2];
      const between = text.slice(beforeJoiner.end, part.start);
      if (!/\s/u.test(between)) {
        merged.splice(merged.length - 2, 2, {
          start: beforeJoiner.start,
          end: part.end,
          segment: text.slice(beforeJoiner.start, part.end),
          isWordLike: true,
        });
        continue;
      }
    }
    merged.push(part);
  }
  return merged;
}

/**
 * Segment words while retaining every non-whitespace source span. Intl's
 * word segmenter is used when present because it handles CJK and Thai without
 * pretending that a whitespace-delimited paragraph is one word.
 */
export function wordSegments(text: string, languageTag = "und"): TextSegment[] {
  if (!text) return [];
  const intl = segmenter(languageTag, "word");
  if (intl) {
    const parts = Array.from(intl.segment(text), (part) => ({
      start: part.index,
      end: part.index + part.segment.length,
      segment: part.segment,
      isWordLike: Boolean(part.isWordLike) || isLetterOrNumber(part.segment),
    })).filter((part) => !isWhitespace(part.segment));
    return mergeInternalJoiners(text, parts);
  }

  return fallbackTokenMatches(text).map((part) => ({
    start: part.start,
    end: part.end,
    segment: part.surface,
    isWordLike: part.isWordLike,
  }));
}

/** Return sentence-like boundaries using Intl, with a punctuation fallback. */
export function sentenceSegments(text: string, languageTag = "und"): TextSegment[] {
  if (!text) return [];
  const intl = segmenter(languageTag, "sentence");
  if (intl) {
    return Array.from(intl.segment(text), (part) => ({
      start: part.index,
      end: part.index + part.segment.length,
      segment: part.segment,
      isWordLike: true,
    }));
  }

  const output: TextSegment[] = [];
  let start = 0;
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const char = text.slice(index, index + width);
    const isBoundary = /[.!?。！？؟]/u.test(char) || char === "\n";
    index += width;
    if (isBoundary) {
      // Include adjacent closing punctuation and whitespace in the sentence
      // span so source recovery remains exact and the next sentence starts at
      // a stable boundary.
      while (index < text.length && /[\s»”’)]/u.test(text[index])) index += 1;
      output.push({ start, end: index, segment: text.slice(start, index), isWordLike: true });
      start = index;
    }
  }
  if (start < text.length || output.length === 0) {
    output.push({ start, end: text.length, segment: text.slice(start), isWordLike: true });
  }
  return output;
}

/** NFC preserves source spans while making decomposed/composed lookup equal. */
export function normalizeForLookup(value: string, languageTag?: LanguageTag | string): string {
  const normalized = value.normalize("NFC");
  try {
    return languageTag ? normalized.toLocaleLowerCase(languageTag) : normalized.toLocaleLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

const hasUnicodeProperties = (() => {
  try {
    new RegExp("\\p{L}", "u");
    return true;
  } catch {
    return false;
  }
})();

const PROPERTY_CLASS = hasUnicodeProperties ? "\\p{L}\\p{M}\\p{N}" : "A-Za-zÀ-ÖØ-öø-ÿ\u0370-\u052F\u1E00-\u1EFF";
const WORD_RE = new RegExp(
  `[${PROPERTY_CLASS}]+(?:['’\\u2010-\\u2015-][${PROPERTY_CLASS}]+)*`,
  hasUnicodeProperties ? "gu" : "g",
);

const SCRIPT_PATTERNS: Array<[ScriptName, RegExp]> = hasUnicodeProperties
  ? [
      ["arabic", /\p{Script=Arabic}/u],
      ["armenian", /\p{Script=Armenian}/u],
      ["bengali", /\p{Script=Bengali}/u],
      ["cyrillic", /\p{Script=Cyrillic}/u],
      ["devanagari", /\p{Script=Devanagari}/u],
      ["georgian", /\p{Script=Georgian}/u],
      ["greek", /\p{Script=Greek}/u],
      ["hebrew", /\p{Script=Hebrew}/u],
      ["han", /\p{Script=Han}/u],
      ["hangul", /\p{Script=Hangul}/u],
      ["hiragana", /\p{Script=Hiragana}/u],
      ["katakana", /\p{Script=Katakana}/u],
      ["latin", /\p{Script=Latin}/u],
      ["thai", /\p{Script=Thai}/u],
    ]
  : [
      ["arabic", /[\u0600-\u06ff]/],
      ["cyrillic", /[\u0400-\u052f]/],
      ["greek", /[\u0370-\u03ff]/],
      ["han", /[\u3400-\u9fff\uf900-\ufaff]/],
      ["hangul", /[\uac00-\ud7af]/],
      ["hiragana", /[\u3040-\u309f]/],
      ["katakana", /[\u30a0-\u30ff]/],
      ["latin", /[A-Za-zÀ-ÖØ-öø-ÿ]/],
      ["thai", /[\u0e00-\u0e7f]/],
    ];

const RTL_RE = hasUnicodeProperties ? /\p{Script=Arabic}|\p{Script=Hebrew}/u : /[\u0590-\u08ff]/;

export function scriptMetadata(value: string): ScriptMetadata {
  const found: ScriptName[] = [];
  for (const [script, pattern] of SCRIPT_PATTERNS) {
    if (pattern.test(value)) found.push(script);
  }
  const scripts = [...new Set(found)];
  const script: ScriptName = scripts.length === 0 ? "unknown" : scripts.length === 1 ? scripts[0] : "mixed";
  const hasLtr = scripts.some((item) => item !== "arabic" && item !== "hebrew");
  const hasRtl = RTL_RE.test(value);
  const direction: TextDirection = hasLtr && hasRtl ? "mixed" : hasRtl ? "rtl" : hasLtr ? "ltr" : "unknown";
  return scripts.length > 1 ? { script, direction, scripts } : { script, direction };
}

export function tokenKind(surface: string, isWordLike = false): TokenKind {
  WORD_RE.lastIndex = 0;
  if (isWordLike || WORD_RE.test(surface)) {
    return /^\p{N}+$/u.test(surface) ? "number" : "word";
  }
  if (/^[\p{P}\p{M}]+$/u.test(surface)) return "punctuation";
  if (/^[\p{S}]+$/u.test(surface)) return "symbol";
  if (/^\d+$/u.test(surface)) return "number";
  return "other";
}

export function confidence(score: number | null): Confidence {
  if (score === null || !Number.isFinite(score)) return { score: null, label: "unknown" };
  const bounded = Math.max(0, Math.min(1, score));
  return { score: bounded, label: bounded >= 0.85 ? "high" : bounded >= 0.6 ? "medium" : "low" };
}

export function isWhitespace(value: string): boolean {
  return /^\s+$/u.test(value);
}

export function isLexicalToken(kind: TokenKind, surface: string): boolean {
  return (kind === "word" || kind === "number") && !isWhitespace(surface);
}

/** Generic fallback matches that retain punctuation and never collapse CJK into one paragraph token. */
export function fallbackTokenMatches(text: string): Array<{ start: number; end: number; surface: string; isWordLike: boolean }> {
  const output: Array<{ start: number; end: number; surface: string; isWordLike: boolean }> = [];
  if (!text) return output;

  const intl = segmenter("und", "word");
  if (intl) {
    const parts = Array.from(intl.segment(text), (part) => ({
      start: part.index,
      end: part.index + part.segment.length,
      surface: part.segment,
      isWordLike: Boolean(part.isWordLike) || isLetterOrNumber(part.segment),
    })).filter((part) => !isWhitespace(part.surface));
    return parts;
  }

  let match: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(text))) {
    if (!isCjkLike(match[0])) {
      output.push({ start: match.index, end: match.index + match[0].length, surface: match[0], isWordLike: true });
    }
  }
  const occupied = new Uint8Array(text.length);
  for (const item of output) occupied.fill(1, item.start, item.end);
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    if (!occupied[index] && !isWhitespace(text.slice(index, index + width))) {
      const surface = text.slice(index, index + width);
      const script = scriptMetadata(surface).script;
      const shouldKeepSeparate = script === "han" || script === "hiragana" || script === "katakana" || script === "hangul" || script === "thai";
      if (shouldKeepSeparate || !isLetterOrNumber(surface)) {
        output.push({ start: index, end: index + width, surface, isWordLike: false });
      }
    }
    index += width;
  }
  return output.sort((a, b) => a.start - b.start);
}
