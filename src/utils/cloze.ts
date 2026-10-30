import { renderAnkiHtmlWithLatex } from "./ankiLatex";
import { evaluateCardOcclusion, isOcclusionCard } from "./occlusion";

export interface ClozeCardInput {
  id?: string;
  item_type?: string | null;
  itemType?: string | null;
  question?: string | null;
  answer?: string | null;
  cloze_text?: string | null;
  clozeText?: string | null;
  cloze_ranges?: unknown;
  clozeRanges?: unknown;
  interaction_metadata?: unknown;
  interactionMetadata?: unknown;
  image_asset_ids?: unknown;
  imageAssetIds?: unknown;
}

export type ClozeRepairReason =
  | "malformed_markers"
  | "empty_deletion"
  | "invalid_ranges"
  | "html_boundary_split"
  | "placeholder_missing_answer"
  | "placeholder_ambiguous"
  | "missing_deletions";

export type ClozeRangeEncoding = "utf16" | "utf8" | "scalar";

export interface ClozeDeletionSpan {
  /** 0-based order of appearance in the prompt. */
  index: number;
  /** 1-based cloze identifier (`c1`, `c2`, ...). */
  number: number;
  /** Raw deletion answer content. */
  answer: string;
  /** Optional hint displayed before reveal. */
  hint?: string;
  /** Start offset in `sourceText` (UTF-16 code units). */
  start: number;
  /** End offset in `sourceText` (UTF-16 code units). */
  end: number;
}

export type ClozeSegment =
  | { type: "text"; text: string }
  | {
      type: "deletion";
      index: number;
      number: number;
      answer: string;
      hint?: string;
    };

export type ClozeEvaluationResult =
  | {
      status: "valid";
      mode: "markers" | "ranges" | "legacy_placeholder";
      sourceText: string;
      segments: ClozeSegment[];
      deletions: ClozeDeletionSpan[];
      rangeEncoding?: ClozeRangeEncoding;
      utf16Ranges?: [number, number][];
    }
  | {
      status: "repair_required";
      reason: ClozeRepairReason;
      message: string;
      sourceText: string;
    };

export interface ClozeEditableProjection {
  markup: string;
  rawSource: string;
  lossless: boolean;
  origin: "markers" | "ranges" | "legacy_placeholder" | "raw_fallback";
  status: "valid" | "repair_required";
  reason?: ClozeRepairReason;
}

interface ScannedRawMarker {
  syntax: "brace" | "bracket";
  start: number;
  end: number;
  rawInner: string;
}

interface ParsedMarkerToken {
  start: number;
  end: number;
  kind: "explicit" | "simplified";
  explicitNumber?: number;
  answer: string;
  hint?: string;
}

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * True when `value` is the legacy card-type placeholder `"Cloze Deletion"` rather than real card content.
 */
export function isClozePlaceholderText(value?: string | null): boolean {
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase() === "cloze deletion";
}

/**
 * True when the card's `item_type` / `itemType` designates a Cloze card.
 */
export function isClozeCardType(card: ClozeCardInput | null | undefined): boolean {
  if (!card || typeof card !== "object") return false;
  const rawType = card.item_type ?? card.itemType ?? "";
  return typeof rawType === "string" && rawType.trim().toLowerCase() === "cloze";
}

/**
 * Canonical raw source selection (D5 / C11):
 * Prefer non-empty `cloze_text`; ignore placeholder question `"Cloze Deletion"`;
 * fall back to `question` when `cloze_text` is empty or absent.
 */
export function selectCanonicalClozeSource(card: ClozeCardInput): {
  sourceText: string;
  usedPlaceholderFallback: boolean;
} {
  const rawCloze = card.cloze_text ?? card.clozeText ?? "";
  if (typeof rawCloze === "string" && rawCloze.trim().length > 0) {
    return { sourceText: rawCloze, usedPlaceholderFallback: false };
  }
  const rawQuestion = card.question ?? "";
  if (typeof rawQuestion !== "string" || rawQuestion.trim().length === 0) {
    return { sourceText: "", usedPlaceholderFallback: false };
  }
  if (isClozePlaceholderText(rawQuestion)) {
    return { sourceText: "", usedPlaceholderFallback: true };
  }
  return { sourceText: rawQuestion, usedPlaceholderFallback: false };
}

function isLegacyBracketCandidateAt(text: string, pos: number): boolean {
  if (!text.startsWith("[[", pos)) return false;
  const rest = text.slice(pos + 2);
  // Recognize [[c1::...]], malformed [[c::...]], or empty [[]] / [[::...]]
  return (
    /^c\d*::/i.test(rest) ||
    rest.startsWith("]]") ||
    rest.startsWith("::") ||
    /^c\d+\b/i.test(rest)
  );
}

/**
 * Linear brace/bracket-aware scanner for `{{...}}` and legacy `[[cN::...]]` markers.
 * Single LaTeX braces like `\frac{1}{2}` or `\frac{1}{\sqrt{2}}` outside `{{...}}`
 * are untouched, and balanced single `{...}` inside `{{...}}` (e.g. `{{c1::\frac{1}{2}}}`)
 * are tracked via `innerDepth` so `}}}` closes the inner brace first and the marker second.
 */
function scanClozeMarkers(
  text: string,
):
  | { ok: true; markers: ScannedRawMarker[] }
  | { ok: false; reason: "malformed_markers" } {
  const markers: ScannedRawMarker[] = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith("{{", i)) {
      let j = i + 2;
      let innerBraceDepth = 0;
      let closedAt = -1;

      while (j < text.length) {
        if (innerBraceDepth === 0 && text.startsWith("{{", j)) {
          return { ok: false, reason: "malformed_markers" };
        }
        if (innerBraceDepth === 0 && text.startsWith("}}", j)) {
          closedAt = j;
          break;
        }
        const ch = text[j];
        if (ch === "{") {
          innerBraceDepth += 1;
          j += 1;
        } else if (ch === "}") {
          if (innerBraceDepth > 0) {
            innerBraceDepth -= 1;
          }
          j += 1;
        } else {
          j += 1;
        }
      }

      if (closedAt === -1) {
        return { ok: false, reason: "malformed_markers" };
      }

      markers.push({
        syntax: "brace",
        start: i,
        end: closedAt + 2,
        rawInner: text.slice(i + 2, closedAt),
      });
      i = closedAt + 2;
      continue;
    }

    if (isLegacyBracketCandidateAt(text, i)) {
      let j = i + 2;
      let innerBracketDepth = 0;
      let closedAt = -1;

      while (j < text.length) {
        if (innerBracketDepth === 0 && isLegacyBracketCandidateAt(text, j)) {
          return { ok: false, reason: "malformed_markers" };
        }
        if (innerBracketDepth === 0 && text.startsWith("]]", j)) {
          closedAt = j;
          break;
        }
        const ch = text[j];
        if (ch === "[") {
          innerBracketDepth += 1;
          j += 1;
        } else if (ch === "]") {
          if (innerBracketDepth > 0) {
            innerBracketDepth -= 1;
          }
          j += 1;
        } else {
          j += 1;
        }
      }

      if (closedAt === -1) {
        return { ok: false, reason: "malformed_markers" };
      }

      markers.push({
        syntax: "bracket",
        start: i,
        end: closedAt + 2,
        rawInner: text.slice(i + 2, closedAt),
      });
      i = closedAt + 2;
      continue;
    }

    i += 1;
  }

  return { ok: true, markers };
}

function parseScannedMarkers(
  markers: ScannedRawMarker[],
):
  | { ok: true; tokens: Array<ParsedMarkerToken & { number: number }> }
  | { ok: false; reason: "malformed_markers" | "empty_deletion" } {
  const parsed: ParsedMarkerToken[] = [];
  const usedNumbers = new Set<number>();

  for (const marker of markers) {
    const { rawInner, syntax, start, end } = marker;
    if (rawInner.trim().length === 0) {
      return { ok: false, reason: "empty_deletion" };
    }

    if (/^c::/i.test(rawInner)) {
      return { ok: false, reason: "malformed_markers" };
    }

    const explicitMatch = /^c(\d+)::([\s\S]*)$/.exec(rawInner);
    if (explicitMatch) {
      const explicitNumber = Number.parseInt(explicitMatch[1], 10);
      if (!Number.isFinite(explicitNumber) || explicitNumber <= 0) {
        return { ok: false, reason: "malformed_markers" };
      }
      const body = explicitMatch[2];
      const sepIdx = body.indexOf("::");
      const answer = sepIdx === -1 ? body : body.slice(0, sepIdx);
      const rawHint = sepIdx === -1 ? undefined : body.slice(sepIdx + 2);
      if (answer.trim().length === 0) {
        return { ok: false, reason: "empty_deletion" };
      }
      const hint = rawHint !== undefined && rawHint.trim().length > 0 ? rawHint : undefined;
      usedNumbers.add(explicitNumber);
      parsed.push({
        start,
        end,
        kind: "explicit",
        explicitNumber,
        answer,
        hint,
      });
      continue;
    }

    if (syntax === "bracket") {
      return { ok: false, reason: "malformed_markers" };
    }

    // Simplified `{{answer}}`, `{{::answer}}`, or `{{answer::hint}}`
    const stripped = rawInner.startsWith("::") ? rawInner.slice(2) : rawInner;
    if (stripped.trim().length === 0) {
      return { ok: false, reason: "empty_deletion" };
    }
    const sepIdx = stripped.indexOf("::");
    const answer = sepIdx === -1 ? stripped : stripped.slice(0, sepIdx);
    const rawHint = sepIdx === -1 ? undefined : stripped.slice(sepIdx + 2);
    if (answer.trim().length === 0) {
      return { ok: false, reason: "empty_deletion" };
    }
    const hint = rawHint !== undefined && rawHint.trim().length > 0 ? rawHint : undefined;
    parsed.push({
      start,
      end,
      kind: "simplified",
      answer,
      hint,
    });
  }

  let nextSimplifiedNumber = 1;
  const allocated = parsed.map((token) => {
    if (token.kind === "explicit" && token.explicitNumber !== undefined) {
      return { ...token, number: token.explicitNumber };
    }
    while (usedNumbers.has(nextSimplifiedNumber)) {
      nextSimplifiedNumber += 1;
    }
    const assigned = nextSimplifiedNumber;
    usedNumbers.add(assigned);
    nextSimplifiedNumber += 1;
    return { ...token, number: assigned };
  });

  return { ok: true, tokens: allocated };
}

/**
 * Normalize simplified cloze deletions (`{{word}}`, `{{::word}}`) and legacy
 * bracket clozes (`[[cN::word]]`, `[[cN::word::hint]]`) to standard `{{cN::...}}`
 * syntax without colliding with explicit `cN` markers, while leaving single LaTeX
 * braces (`\frac{1}{2}`) untouched.
 */
export function normalizeClozeSyntax(text: string): string {
  if (!text) return text;
  const scanned = scanClozeMarkers(text);
  if (!scanned.ok || scanned.markers.length === 0) {
    return text;
  }
  const parsed = parseScannedMarkers(scanned.markers);
  if (parsed.ok === false) {
    return text;
  }

  let out = "";
  let cursor = 0;
  for (const token of parsed.tokens) {
    out += text.slice(cursor, token.start);
    const suffix = token.hint !== undefined ? `::${token.hint}` : "";
    out += `{{c${token.number}::${token.answer}${suffix}}}`;
    cursor = token.end;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * Parse `{{cN::text}}`, `{{cN::text::hint}}`, simplified `{{text}}` / `{{::text}}`,
 * and legacy `[[cN::text]]` cloze deletions (including multiline content and LaTeX braces).
 */
export function parseClozeDeletions(text: string): Array<{
  start: number;
  end: number;
  content: string;
  hint?: string;
  number: number;
}> {
  if (!text) return [];
  const normalized = normalizeClozeSyntax(text);
  const scanned = scanClozeMarkers(normalized);
  if (!scanned.ok || scanned.markers.length === 0) return [];
  const parsed = parseScannedMarkers(scanned.markers);
  if (parsed.ok === false) return [];

  return parsed.tokens.map((token) => ({
    start: token.start,
    end: token.end,
    content: token.answer,
    hint: token.hint,
    number: token.number,
  }));
}

/**
 * Check if text contains raw valid or malformed cloze deletion syntax (`{{...}}` or `[[cN::...]]`).
 */
export function hasRawClozeSyntax(text: string): boolean {
  if (!text) return false;
  const scanned = scanClozeMarkers(text);
  if (scanned.ok === false) return true;
  if (scanned.markers.length === 0) return false;
  const parsed = parseScannedMarkers(scanned.markers);
  return parsed.ok ? parsed.tokens.length > 0 : true;
}

/**
 * Strip valid cloze markers and return text with just the deletion answers in place.
 */
export function stripClozeMarkers(text: string): string {
  if (!text) return text;
  const scanned = scanClozeMarkers(text);
  if (!scanned.ok || scanned.markers.length === 0) return text;
  const parsed = parseScannedMarkers(scanned.markers);
  if (parsed.ok === false) return text;

  let out = "";
  let cursor = 0;
  for (const token of parsed.tokens) {
    out += text.slice(cursor, token.start);
    out += token.answer;
    cursor = token.end;
  }
  out += text.slice(cursor);
  return out;
}

export function isBalancedHtmlFragment(fragment: string): boolean {
  if (!fragment || (!fragment.includes("<") && !fragment.includes(">"))) {
    return true;
  }
  // Reject unclosed `<tag...` without `>`
  const tagScan = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*(\/?)>/g;
  const stack: string[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = tagScan.exec(fragment)) !== null) {
    const gap = fragment.slice(lastEnd, match.index);
    if (/<[a-zA-Z!/]/.test(gap)) {
      return false;
    }
    const full = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = full.startsWith("</");
    const isSelfClosing = match[2] === "/" || VOID_HTML_TAGS.has(tagName);

    if (isClosing) {
      if (VOID_HTML_TAGS.has(tagName)) {
        return false;
      }
      if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
        return false;
      }
      stack.pop();
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
    lastEnd = match.index + full.length;
  }

  const tail = fragment.slice(lastEnd);
  if (/<[a-zA-Z!/]/.test(tail)) {
    return false;
  }

  return stack.length === 0;
}

/**
 * Validate that UTF-16 `[start, end]` ranges on `text` do not land inside `<...>` HTML tags,
 * do not split `&...;` HTML entities, and do not slice unbalanced HTML open/close tags.
 */
export function validateHtmlSafeRanges(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>,
): { valid: true } | { valid: false; reason: "invalid_ranges" | "html_boundary_split" } {
  if (ranges.length === 0) {
    return { valid: false, reason: "invalid_ranges" };
  }

  // Validate basic UTF-16 ordering and surrogate boundaries first
  for (let i = 0; i < ranges.length; i += 1) {
    const [start, end] = ranges[i];
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > text.length ||
      (i > 0 && start < ranges[i - 1][1])
    ) {
      return { valid: false, reason: "invalid_ranges" };
    }
    if (!isValidUtf16CodePointBoundary(text, start) || !isValidUtf16CodePointBoundary(text, end)) {
      return { valid: false, reason: "invalid_ranges" };
    }
  }

  // 1. Check `<...>` HTML tag spans
  const htmlTagSpans: Array<[number, number]> = [];
  const tagPattern = /<[a-zA-Z!/][^>]*>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(text)) !== null) {
    htmlTagSpans.push([tagMatch.index, tagMatch.index + tagMatch[0].length]);
  }

  // 2. Check `&...;` HTML entity spans
  const entitySpans: Array<[number, number]> = [];
  const entityPattern = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
  let entityMatch: RegExpExecArray | null;
  while ((entityMatch = entityPattern.exec(text)) !== null) {
    entitySpans.push([entityMatch.index, entityMatch.index + entityMatch[0].length]);
  }

  for (const [start, end] of ranges) {
    for (const [spanStart, spanEnd] of htmlTagSpans) {
      if ((start > spanStart && start < spanEnd) || (end > spanStart && end < spanEnd)) {
        return { valid: false, reason: "html_boundary_split" };
      }
    }
    for (const [spanStart, spanEnd] of entitySpans) {
      if ((start > spanStart && start < spanEnd) || (end > spanStart && end < spanEnd)) {
        return { valid: false, reason: "html_boundary_split" };
      }
    }
    const slice = text.slice(start, end);
    if (!isBalancedHtmlFragment(slice)) {
      return { valid: false, reason: "html_boundary_split" };
    }
  }

  // 3. Replacing every deletion with neutral text must leave balanced outer HTML
  let outerWithPlaceholders = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    outerWithPlaceholders += text.slice(cursor, start);
    outerWithPlaceholders += "CLOZE";
    cursor = end;
  }
  outerWithPlaceholders += text.slice(cursor);
  if (!isBalancedHtmlFragment(outerWithPlaceholders)) {
    return { valid: false, reason: "html_boundary_split" };
  }

  return { valid: true };
}

function isValidUtf16CodePointBoundary(text: string, utf16Index: number): boolean {
  if (utf16Index < 0 || utf16Index > text.length) return false;
  if (utf16Index === 0 || utf16Index === text.length) return true;
  const prev = text.charCodeAt(utf16Index - 1);
  const curr = text.charCodeAt(utf16Index);
  // Splitting a high surrogate (0xD800..0xDBFF) from a low surrogate (0xDC00..0xDFFF) is invalid
  const prevIsHigh = prev >= 0xd800 && prev <= 0xdbff;
  const currIsLow = curr >= 0xdc00 && curr <= 0xdfff;
  return !(prevIsHigh && currIsLow);
}

function utf8ByteLengthOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

interface OffsetMaps {
  utf16ValidBoundaries: Set<number>;
  utf8ToUtf16: Map<number, number>;
  scalarToUtf16: number[];
}

function buildOffsetMaps(text: string): OffsetMaps {
  const utf16ValidBoundaries = new Set<number>([0]);
  const utf8ToUtf16 = new Map<number, number>([[0, 0]]);
  const scalarToUtf16: number[] = [0];

  let utf16Pos = 0;
  let utf8Pos = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0;
    utf16Pos += ch.length;
    utf8Pos += utf8ByteLengthOfCodePoint(codePoint);
    utf16ValidBoundaries.add(utf16Pos);
    utf8ToUtf16.set(utf8Pos, utf16Pos);
    scalarToUtf16.push(utf16Pos);
  }

  return { utf16ValidBoundaries, utf8ToUtf16, scalarToUtf16 };
}

function parseRawRangesInput(
  rawRanges: unknown,
):
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "present"; pairs: [number, number][] } {
  if (rawRanges === undefined || rawRanges === null) {
    return { state: "absent" };
  }

  let candidate: unknown = rawRanges;
  if (typeof rawRanges === "string") {
    const trimmed = rawRanges.trim();
    if (trimmed.length === 0) return { state: "absent" };
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return { state: "invalid" };
    }
  }

  if (!Array.isArray(candidate)) {
    return { state: "invalid" };
  }
  if (candidate.length === 0) {
    return { state: "absent" };
  }

  const pairs: [number, number][] = [];
  for (let i = 0; i < candidate.length; i += 1) {
    const entry = candidate[i];
    if (!Array.isArray(entry) || entry.length !== 2) {
      return { state: "invalid" };
    }
    const [start, end] = entry;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start
    ) {
      return { state: "invalid" };
    }
    // Must be ordered and non-overlapping as stored (`0 <= start < end`, `prevEnd <= start`)
    if (i > 0 && start < pairs[i - 1][1]) {
      return { state: "invalid" };
    }
    pairs.push([start, end]);
  }

  return { state: "present", pairs };
}

function isWordCharacter(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[\p{L}\p{N}_]/u.test(ch);
}

function scoreCandidateUtf16Ranges(
  text: string,
  ranges: [number, number][],
  expectedAnswer?: string | null,
): number {
  let score = 0;
  const trimmedExpected = expectedAnswer?.trim() ?? "";
  const slices = ranges.map(([s, e]) => text.slice(s, e));

  if (trimmedExpected.length > 0 && !isClozePlaceholderText(trimmedExpected)) {
    if (
      (slices.length === 1 && slices[0].trim() === trimmedExpected) ||
      slices.map((s) => s.trim()).join("; ") === trimmedExpected
    ) {
      score += 100;
    }
  }

  for (const [start, end] of ranges) {
    const slice = text.slice(start, end);
    if (slice === slice.trim()) {
      score += 10;
    }
    const prevChar = start > 0 ? Array.from(text.slice(Math.max(0, start - 2), start)).pop() : undefined;
    const firstChar = Array.from(slice)[0];
    if (!isWordCharacter(prevChar) || !isWordCharacter(firstChar)) {
      score += 5;
    }
    const lastChar = Array.from(slice).pop();
    const nextChar = end < text.length ? Array.from(text.slice(end, Math.min(text.length, end + 2)))[0] : undefined;
    if (!isWordCharacter(lastChar) || !isWordCharacter(nextChar)) {
      score += 5;
    }
  }

  return score;
}

/**
 * Resolve marker-free `cloze_ranges` deterministically across UTF-16 code-unit offsets,
 * UTF-8 byte offsets (Rust `Vec<(usize, usize)>`), and Unicode scalar (`char`) offsets,
 * validating code-point boundaries and HTML/entity boundaries.
 */
export function resolveMarkerFreeClozeRanges(
  text: string,
  rawRanges: unknown,
  options?: { expectedAnswer?: string | null; encoding?: "auto" | ClozeRangeEncoding },
):
  | { ok: true; ranges: [number, number][]; encoding: ClozeRangeEncoding }
  | { ok: false; reason: "missing_deletions" | "invalid_ranges" | "html_boundary_split" } {
  const parsedInput = parseRawRangesInput(rawRanges);
  if (parsedInput.state === "absent") {
    return { ok: false, reason: "missing_deletions" };
  }
  if (parsedInput.state === "invalid") {
    return { ok: false, reason: "invalid_ranges" };
  }

  const { pairs } = parsedInput;
  const maps = buildOffsetMaps(text);
  const encodingsToTry: ClozeRangeEncoding[] =
    options?.encoding && options.encoding !== "auto"
      ? [options.encoding]
      : ["utf16", "utf8", "scalar"];

  const validCandidates: Array<{
    encoding: ClozeRangeEncoding;
    ranges: [number, number][];
    score: number;
  }> = [];
  let sawHtmlBoundarySplit = false;

  for (const encoding of encodingsToTry) {
    const mapped: [number, number][] = [];
    let mappingValid = true;

    for (let i = 0; i < pairs.length; i += 1) {
      const [rawStart, rawEnd] = pairs[i];
      let uStart: number | undefined;
      let uEnd: number | undefined;

      if (encoding === "utf16") {
        if (maps.utf16ValidBoundaries.has(rawStart) && maps.utf16ValidBoundaries.has(rawEnd)) {
          uStart = rawStart;
          uEnd = rawEnd;
        }
      } else if (encoding === "utf8") {
        uStart = maps.utf8ToUtf16.get(rawStart);
        uEnd = maps.utf8ToUtf16.get(rawEnd);
      } else {
        if (rawStart < maps.scalarToUtf16.length && rawEnd < maps.scalarToUtf16.length) {
          uStart = maps.scalarToUtf16[rawStart];
          uEnd = maps.scalarToUtf16[rawEnd];
        }
      }

      if (
        uStart === undefined ||
        uEnd === undefined ||
        uEnd <= uStart ||
        (i > 0 && uStart < mapped[i - 1][1])
      ) {
        mappingValid = false;
        break;
      }

      const slice = text.slice(uStart, uEnd);
      if (slice.trim().length === 0) {
        mappingValid = false;
        break;
      }

      mapped.push([uStart, uEnd]);
    }

    if (!mappingValid) continue;

    const htmlValidation = validateHtmlSafeRanges(text, mapped);
    if (htmlValidation.valid === false) {
      if (htmlValidation.reason === "html_boundary_split") {
        sawHtmlBoundarySplit = true;
      }
      continue;
    }

    validCandidates.push({
      encoding,
      ranges: mapped,
      score: scoreCandidateUtf16Ranges(text, mapped, options?.expectedAnswer),
    });
  }

  if (validCandidates.length === 0) {
    return {
      ok: false,
      reason: sawHtmlBoundarySplit ? "html_boundary_split" : "invalid_ranges",
    };
  }

  // Sort strictly by score descending; tie-break preserves ["utf16", "utf8", "scalar"] priority
  validCandidates.sort((a, b) => b.score - a.score);
  const winner = validCandidates[0];
  return {
    ok: true,
    ranges: winner.ranges,
    encoding: winner.encoding,
  };
}

function repairMessageForReason(reason: ClozeRepairReason): string {
  switch (reason) {
    case "malformed_markers":
      return "This cloze card has unclosed or malformed cloze markers and cannot be safely hidden.";
    case "empty_deletion":
      return "This cloze card contains an empty deletion marker with no answer text.";
    case "invalid_ranges":
      return "This cloze card has invalid or out-of-bounds deletion ranges.";
    case "html_boundary_split":
      return "This cloze card's deletion ranges split an HTML tag or entity boundary.";
    case "placeholder_missing_answer":
      return "This legacy [...] cloze card is missing its answer.";
    case "placeholder_ambiguous":
      return "This legacy [...] cloze card has multiple blanks without unambiguous markers.";
    case "missing_deletions":
    default:
      return "This cloze card has no hideable cloze deletions. Edit the card to wrap an answer in {{c1::...}}.";
  }
}

/**
 * Evaluate a Cloze card into either a validated set of text/deletion segments
 * or a typed `repair_required` state that withholds plaintext answer leakage and grading.
 */
export function evaluateClozeCard(card: ClozeCardInput): ClozeEvaluationResult {
  const { sourceText } = selectCanonicalClozeSource(card);

  if (sourceText.trim().length === 0) {
    return {
      status: "repair_required",
      reason: "missing_deletions",
      message: repairMessageForReason("missing_deletions"),
      sourceText,
    };
  }

  // 1. Scan markers FIRST so malformed/empty markers fail before falling back to ranges (C12),
  //    and valid markers ALWAYS win over stored ranges (C07).
  const scanned = scanClozeMarkers(sourceText);
  if (scanned.ok === false) {
    return {
      status: "repair_required",
      reason: scanned.reason,
      message: repairMessageForReason(scanned.reason),
      sourceText,
    };
  }

  if (scanned.markers.length > 0) {
    const parsed = parseScannedMarkers(scanned.markers);
    if (parsed.ok === false) {
      return {
        status: "repair_required",
        reason: parsed.reason,
        message: repairMessageForReason(parsed.reason),
        sourceText,
      };
    }

    const segments: ClozeSegment[] = [];
    const deletions: ClozeDeletionSpan[] = [];
    let cursor = 0;

    parsed.tokens.forEach((token, idx) => {
      if (token.start > cursor) {
        segments.push({ type: "text", text: sourceText.slice(cursor, token.start) });
      }
      deletions.push({
        index: idx,
        number: token.number,
        answer: token.answer,
        hint: token.hint,
        start: token.start,
        end: token.end,
      });
      segments.push({
        type: "deletion",
        index: idx,
        number: token.number,
        answer: token.answer,
        hint: token.hint,
      });
      cursor = token.end;
    });

    if (cursor < sourceText.length) {
      segments.push({ type: "text", text: sourceText.slice(cursor) });
    }

    return {
      status: "valid",
      mode: "markers",
      sourceText,
      segments,
      deletions,
    };
  }

  // 2. Marker-free legacy `cloze_ranges`
  const rawRanges = card.cloze_ranges ?? card.clozeRanges;
  const parsedRangeInput = parseRawRangesInput(rawRanges);
  if (parsedRangeInput.state !== "absent") {
    const resolved = resolveMarkerFreeClozeRanges(sourceText, rawRanges, {
      expectedAnswer: card.answer,
    });
    if (resolved.ok === false) {
      const reason = resolved.reason === "missing_deletions" ? "invalid_ranges" : resolved.reason;
      return {
        status: "repair_required",
        reason,
        message: repairMessageForReason(reason),
        sourceText,
      };
    }

    const segments: ClozeSegment[] = [];
    const deletions: ClozeDeletionSpan[] = [];
    let cursor = 0;

    resolved.ranges.forEach(([start, end], idx) => {
      if (start > cursor) {
        segments.push({ type: "text", text: sourceText.slice(cursor, start) });
      }
      const answer = sourceText.slice(start, end);
      deletions.push({
        index: idx,
        number: idx + 1,
        answer,
        start,
        end,
      });
      segments.push({
        type: "deletion",
        index: idx,
        number: idx + 1,
        answer,
      });
      cursor = end;
    });

    if (cursor < sourceText.length) {
      segments.push({ type: "text", text: sourceText.slice(cursor) });
    }

    return {
      status: "valid",
      mode: "ranges",
      sourceText,
      segments,
      deletions,
      rangeEncoding: resolved.encoding,
      utf16Ranges: resolved.ranges,
    };
  }

  // 3. Legacy literal `[...]` placeholder without markers or ranges
  const placeholderMatches = Array.from(sourceText.matchAll(/\[\.\.\.\]/g));
  if (placeholderMatches.length > 0) {
    const trimmedAnswer = (card.answer ?? "").trim();
    if (!trimmedAnswer || isClozePlaceholderText(trimmedAnswer)) {
      return {
        status: "repair_required",
        reason: "placeholder_missing_answer",
        message: repairMessageForReason("placeholder_missing_answer"),
        sourceText,
      };
    }
    if (placeholderMatches.length > 1) {
      return {
        status: "repair_required",
        reason: "placeholder_ambiguous",
        message: repairMessageForReason("placeholder_ambiguous"),
        sourceText,
      };
    }

    const matchIndex = placeholderMatches[0].index ?? 0;
    const matchEnd = matchIndex + 5;
    const segments: ClozeSegment[] = [];
    if (matchIndex > 0) {
      segments.push({ type: "text", text: sourceText.slice(0, matchIndex) });
    }
    segments.push({
      type: "deletion",
      index: 0,
      number: 1,
      answer: trimmedAnswer,
    });
    if (matchEnd < sourceText.length) {
      segments.push({ type: "text", text: sourceText.slice(matchEnd) });
    }

    return {
      status: "valid",
      mode: "legacy_placeholder",
      sourceText,
      segments,
      deletions: [
        {
          index: 0,
          number: 1,
          answer: trimmedAnswer,
          start: matchIndex,
          end: matchEnd,
        },
      ],
    };
  }

  // 4. Zero hideable deletions
  return {
    status: "repair_required",
    reason: "missing_deletions",
    message: repairMessageForReason("missing_deletions"),
    sourceText,
  };
}

/**
 * Losslessly project a cloze card (including marker-free legacy `cloze_ranges` or
 * unambiguous `[...]` placeholder cards) into editable `{{cN::...}}` markup.
 * Falls back to `rawSource` with `lossless: false` when reconstruction is unsafe.
 */
export function projectClozeCardToEditableMarkup(card: ClozeCardInput): ClozeEditableProjection {
  const { sourceText } = selectCanonicalClozeSource(card);
  const evaluated = evaluateClozeCard(card);

  if (evaluated.status === "repair_required") {
    return {
      markup: sourceText,
      rawSource: sourceText,
      lossless: false,
      origin: "raw_fallback",
      status: "repair_required",
      reason: evaluated.reason,
    };
  }

  if (evaluated.mode === "markers") {
    const normalized = normalizeClozeSyntax(sourceText);
    return {
      markup: normalized,
      rawSource: sourceText,
      lossless: true,
      origin: "markers",
      status: "valid",
    };
  }

  // Reconstruct `{{cN::answer}}` from segments (`ranges` or `legacy_placeholder`)
  let reconstructed = "";
  for (const segment of evaluated.segments) {
    if (segment.type === "text") {
      reconstructed += segment.text;
    } else {
      const suffix = segment.hint !== undefined ? `::${segment.hint}` : "";
      reconstructed += `{{c${segment.number}::${segment.answer}${suffix}}}`;
    }
  }

  // Verify lossless round-trip
  const reevaluated = evaluateClozeCard({
    item_type: "Cloze",
    cloze_text: reconstructed,
  });
  const roundTripsCleanly =
    reevaluated.status === "valid" &&
    reevaluated.mode === "markers" &&
    reevaluated.deletions.length === evaluated.deletions.length &&
    reevaluated.deletions.every((d, i) => d.answer === evaluated.deletions[i].answer);

  if (!roundTripsCleanly) {
    return {
      markup: sourceText,
      rawSource: sourceText,
      lossless: false,
      origin: "raw_fallback",
      status: "valid",
    };
  }

  return {
    markup: reconstructed,
    rawSource: sourceText,
    lossless: true,
    origin: evaluated.mode,
    status: "valid",
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a validated cloze evaluation into sanitized Anki/LaTeX HTML, preserving
 * formatting across/inside deletions while guaranteeing zero hidden-answer DOM output
 * when `revealed === false`.
 */
export function renderClozeSegmentsHtml(
  evaluation: Extract<ClozeEvaluationResult, { status: "valid" }>,
  revealed: boolean,
  options?: {
    blankClassName?: string;
    revealedClassName?: string;
  },
): string {
  const blankClass =
    options?.blankClassName ??
    "inline-block rounded bg-muted px-2 py-0.5 font-bold text-foreground border border-border/50";
  const revealedClass =
    options?.revealedClassName ??
    "inline-block rounded bg-primary/20 px-1.5 py-0.5 font-semibold text-foreground";

  const renderDeletionSpan = (seg: Extract<ClozeSegment, { type: "deletion" }>): string => {
    if (!revealed) {
      const label = escapeHtml(seg.hint || "[...]");
      return `<span data-testid="cloze-blank" data-cloze-deletion="${seg.number}" data-cloze-state="hidden" class="${escapeHtml(blankClass)}">${label}</span>`;
    }
    const answerHtml = renderAnkiHtmlWithLatex(seg.answer);
    return `<span data-testid="cloze-revealed" data-cloze-deletion="${seg.number}" data-cloze-state="revealed" class="${escapeHtml(revealedClass)}">${answerHtml}</span>`;
  };

  const textSegmentsBalanced = evaluation.segments.every(
    (seg) => seg.type === "deletion" || isBalancedHtmlFragment(seg.text),
  );

  if (textSegmentsBalanced) {
    return evaluation.segments
      .map((seg) =>
        seg.type === "text" ? renderAnkiHtmlWithLatex(seg.text) : renderDeletionSpan(seg),
      )
      .join("");
  }

  // HTML wraps across deletion boundaries (e.g. `<b>{{c1::mitochondria}}</b>`):
  // render outer HTML with collision-free alphanumeric sentinels, then splice sanitized spans.
  let sentinelPrefix = "PLETHORACLOZETOKEN";
  while (evaluation.sourceText.includes(sentinelPrefix)) {
    sentinelPrefix += "X";
  }

  const deletionSpans = new Map<string, string>();
  let template = "";
  for (const seg of evaluation.segments) {
    if (seg.type === "text") {
      template += seg.text;
    } else {
      const token = `${sentinelPrefix}_${seg.index}_END`;
      deletionSpans.set(token, renderDeletionSpan(seg));
      template += token;
    }
  }

  let renderedOuter = renderAnkiHtmlWithLatex(template);
  for (const [token, spanHtml] of deletionSpans.entries()) {
    renderedOuter = renderedOuter.split(token).join(spanHtml);
  }
  return renderedOuter;
}

export function stripHtmlToPlainText(value?: string | null): string {
  if (!value) return "";
  const withoutAnkiDelims = value
    .replace(/\[\$\$\]|\[\/\$\$\]|\[\$\]|\[\/\$\]|\[latex\]|\[\/latex\]/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");

  let text = withoutAnkiDelims;
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(withoutAnkiDelims, "text/html");
      text = doc.body.textContent || "";
    } catch {
      text = withoutAnkiDelims.replace(/<[^>]+>/g, " ");
    }
  } else {
    text = withoutAnkiDelims.replace(/<[^>]+>/g, " ");
  }

  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength?: number): string {
  if (!maxLength || maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 1) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function shouldTreatAsClozeForSafeOutput(card: ClozeCardInput): boolean {
  if (isClozeCardType(card)) return true;
  const rawCloze = card.cloze_text ?? card.clozeText ?? "";
  if (typeof rawCloze === "string" && rawCloze.trim().length > 0) return true;
  if (typeof card.question === "string" && hasRawClozeSyntax(card.question)) return true;
  return false;
}

/**
 * Build a safe plain-text prompt summary (for queue titles, headers, accessible previews)
 * that never leaks hidden answers, raw `{{...}}`/`[[...]]` markers, or `"Cloze Deletion"`.
 */
export function getSafeCardPromptSummary(
  card: ClozeCardInput,
  opts?: { revealed?: boolean; maxLength?: number; fallback?: string },
): string {
  const revealed = Boolean(opts?.revealed);
  const fallback = opts?.fallback ?? "Flashcard";

  if (shouldTreatAsClozeForSafeOutput(card)) {
    const evalResult = evaluateClozeCard(card);
    if (evalResult.status !== "valid") {
      return truncateText(opts?.fallback ?? "Cloze card (needs repair)", opts?.maxLength);
    }

    const joined = evalResult.segments
      .map((seg) => {
        if (seg.type === "text") {
          return seg.text;
        }
        if (revealed) {
          return seg.answer;
        }
        return seg.hint ? `[${seg.hint}]` : "[...]";
      })
      .join("");
    const plain = stripHtmlToPlainText(joined);
    if (!plain || isClozePlaceholderText(plain)) {
      return truncateText(fallback, opts?.maxLength);
    }
    return truncateText(plain, opts?.maxLength);
  }

  if (isOcclusionCard(card)) {
    const occ = evaluateCardOcclusion(card);
    if (occ.kind === "valid" && occ.prompt) {
      return truncateText(stripHtmlToPlainText(occ.prompt), opts?.maxLength);
    }
    const rawQuestion = typeof card.question === "string" ? card.question : "";
    const plainQuestion = isClozePlaceholderText(rawQuestion)
      ? ""
      : stripHtmlToPlainText(rawQuestion);
    return truncateText(plainQuestion || opts?.fallback || "Image occlusion card", opts?.maxLength);
  }

  const rawQuestion = typeof card.question === "string" ? card.question : "";
  const plainQuestion = isClozePlaceholderText(rawQuestion)
    ? ""
    : stripHtmlToPlainText(rawQuestion);
  return truncateText(plainQuestion || fallback, opts?.maxLength);
}

/**
 * Build safe speech text for automatic or manual TTS on `side` (`"question"` | `"answer"`),
 * guaranteeing zero hidden-answer leakage before reveal, zero raw marker speech,
 * and never speaking `"Cloze Deletion"`.
 */
export function getSafeCardSpeechText(
  card: ClozeCardInput,
  side: "question" | "answer",
): { text: string; speakable: boolean } {
  if (shouldTreatAsClozeForSafeOutput(card)) {
    const evalResult = evaluateClozeCard(card);
    if (evalResult.status !== "valid") {
      return { text: "", speakable: false };
    }

    if (side === "question") {
      const spokenPrompt = evalResult.segments
        .map((seg) => {
          if (seg.type === "text") return seg.text;
          const cleanHint = seg.hint ? stripHtmlToPlainText(seg.hint) : "";
          return cleanHint ? `blank (${cleanHint})` : "blank";
        })
        .join("");
      const plain = stripHtmlToPlainText(spokenPrompt);
      if (!plain || isClozePlaceholderText(plain)) {
        return { text: "", speakable: false };
      }
      return { text: plain, speakable: true };
    }

    const spokenRevealed = evalResult.segments
      .map((seg) => (seg.type === "text" ? seg.text : seg.answer))
      .join("");
    const plain = stripHtmlToPlainText(spokenRevealed);
    if (!plain || isClozePlaceholderText(plain)) {
      return { text: "", speakable: false };
    }
    return { text: plain, speakable: true };
  }

  if (isOcclusionCard(card)) {
    const occ = evaluateCardOcclusion(card);
    if (occ.kind === "invalid_geometry") {
      return { text: "", speakable: false };
    }
    if (side === "question") {
      const promptText =
        (occ.kind === "valid" && occ.prompt ? stripHtmlToPlainText(occ.prompt) : "") ||
        (typeof card.question === "string" && !isClozePlaceholderText(card.question)
          ? stripHtmlToPlainText(card.question)
          : "");
      return promptText ? { text: promptText, speakable: true } : { text: "", speakable: false };
    }
    const rawAns = typeof card.answer === "string" ? stripHtmlToPlainText(card.answer) : "";
    const fallbackLabel =
      occ.kind === "valid" && occ.targetRegion.label
        ? stripHtmlToPlainText(occ.targetRegion.label)
        : "";
    const finalAns = rawAns || fallbackLabel;
    if (!finalAns || isClozePlaceholderText(finalAns)) {
      return { text: "", speakable: false };
    }
    return { text: finalAns, speakable: true };
  }

  if (side === "question") {
    const rawQ = typeof card.question === "string" ? card.question : "";
    const plainQ = isClozePlaceholderText(rawQ) ? "" : stripHtmlToPlainText(rawQ);
    return plainQ ? { text: plainQ, speakable: true } : { text: "", speakable: false };
  }

  const rawA = typeof card.answer === "string" ? card.answer : "";
  const plainA = isClozePlaceholderText(rawA) ? "" : stripHtmlToPlainText(rawA);
  return plainA ? { text: plainA, speakable: true } : { text: "", speakable: false };
}
