/**
 * Selection-intent resolver (spec: selection-intent-resolution; change:
 * unify-selection-dictionary-lookup, design D1/D2).
 *
 * Pure, framework-free classification of a SETTLED selection's text into
 * exactly one intent kind — single lexical word / phrase / URL / none — run at
 * the READY boundary by `useSelectionInteraction` (never at gesture
 * thresholds). Hosts consume `ReadySelection.intent`; they never re-derive it
 * and never implement their own word-splitting heuristics.
 *
 * Classification is Unicode-aware with graceful degradation:
 *  - `Intl.Segmenter` (word granularity) when the platform exposes it;
 *  - otherwise a Unicode-property regex (Latin + digits + combining marks,
 *    intra-word apostrophes/hyphens preserved);
 *  - otherwise a bounded Latin/Cyrillic/Greek/CJK range regex.
 *  Ambiguous tokens ALWAYS degrade to `phrase` (normal selection UX), never to
 *  a wrong single-word dictionary lookup. Known limitation: languages without
 *  word boundaries (Japanese beyond single runs, Thai) rely on the segmenter's
 *  dictionary segmentation; where the platform lacks it the fallback
 *  over-splits and the token resolves as `phrase` — the safe direction.
 */

export type SelectionIntent =
  | { kind: "word"; word: string; queryWord: string }
  | { kind: "phrase" }
  | { kind: "url" }
  | { kind: "none" };

/** How the gesture that produced a READY selection was performed. */
export type GestureOrigin = "touch" | "double-click" | "double-tap" | "mouse" | "keyboard" | "commit";

const NONE: SelectionIntent = { kind: "none" };
const PHRASE: SelectionIntent = { kind: "phrase" };
const URL_INTENT: SelectionIntent = { kind: "url" };

/** Whole-selection URL pattern (checked before punctuation trimming). */
const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;

/** Intra-word joiners: apostrophes and dashes between word-like runs. */
const JOINER_RUN = /^['’\u2019\u2010\u2011\u2012\u2013\u2014\u2015-]+$/;

const segmenterAvailable =
  typeof Intl !== "undefined" && typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter === "function";

const propertyEscapesAvailable = (() => {
  try {
    new RegExp("\\p{L}", "u");
    return true;
  } catch {
    return false;
  }
})();

/** CJK-only run (Han + kana + hangul, no spaces/punctuation) = one word. */
const cjkScriptSource = propertyEscapesAvailable
  ? "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}"
  : "\\u3400-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF\\uAC00-\\uD7AF";
const cjkRun = new RegExp(`^[${cjkScriptSource}]+$`, propertyEscapesAvailable ? "u" : "");
const cjkChar = new RegExp(`[${cjkScriptSource}]`, propertyEscapesAvailable ? "u" : "");

/**
 * Single word-like token for the regex fallback: letters/digits/marks with
 * internal apostrophes and hyphens joining letter runs (`can't`,
 * `mother-in-law`). Bounded ranges cover Latin + diacritics + Greek +
 * Cyrillic when Unicode property escapes are unavailable.
 */
const singleWordFallback: RegExp = propertyEscapesAvailable
  ? /^[\p{L}\p{N}\p{M}]+(?:['’\u2010\u2011\u2012\u2013\u2014\u2015-][\p{L}\p{N}\p{M}]+)*$/u
  : /^[0-9A-Za-z\u00C0-\u024F\u0370-\u04FF\u1E00-\u1EFF]+(?:['’\u2010\u2011\u2012\u2013\u2014\u2015-][0-9A-Za-z\u00C0-\u024F\u0370-\u04FF\u1E00-\u1EFF]+)*$/;

/** Edge punctuation/symbols/controls trimmed before classification. */
const MANUAL_EDGE_PUNCT = "\"'`´‘’“”«»‹›()[]{}.,;:!?…—–-_/\\|@#$%^&*+=<>~";
const escapeCharClass = (chars: string): string =>
  chars.replace(/[\]\\^-]/g, (ch) => `\\${ch}`);
const edgePunct: RegExp = propertyEscapesAvailable
  ? /^[\p{P}\p{S}\p{Cf}]+|[\p{P}\p{S}\p{Cf}]+$/gu
  : new RegExp(
      `^[${escapeCharClass(MANUAL_EDGE_PUNCT)}]+|[${escapeCharClass(MANUAL_EDGE_PUNCT)}]+$`,
      "g",
    );

function trimSelectionEdges(text: string): string {
  return text.replace(edgePunct, "").trim();
}

function classifyWithSegmenter(core: string): boolean {
  const SegmenterCtor = (Intl as unknown as {
    Segmenter: new (locale: string, options: { granularity: "word" }) => IntlSegmenterLike;
  }).Segmenter;
  const segmenter = new SegmenterCtor("en", { granularity: "word" });
  let wordLike = 0;
  for (const segment of segmenter.segment(core)) {
    if (segment.isWordLike) {
      wordLike += 1;
      continue;
    }
    // Multiple word-like runs still form ONE word when joined exclusively by
    // intra-word apostrophes/hyphens ("mother-in-law", "rock'n'roll").
    if (!JOINER_RUN.test(segment.segment)) return false;
  }
  return wordLike > 0;
}

function classifyWithRegex(core: string): boolean {
  return singleWordFallback.test(core);
}

/** Minimal structural type for Intl.Segmenter word segments (ES2022 intl). */
interface IntlSegmenterLike {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

const defaultClassify: (core: string) => boolean = segmenterAvailable
  ? classifyWithSegmenter
  : classifyWithRegex;

function resolveWith(classify: (core: string) => boolean, raw: string | null | undefined): SelectionIntent {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return NONE;
  if (URL_LIKE.test(text)) return URL_INTENT;

  const core = trimSelectionEdges(text);
  if (!core) return NONE; // whitespace/punctuation-only
  if (/\s/.test(core)) return PHRASE; // multi-word (incl. sentences, CJK runs separated by spaces)
  if (cjkRun.test(core)) {
    // CJK special case: a single script-pure run is one word even where the
    // segmenter would split it into dictionary units.
    return { kind: "word", word: core, queryWord: core.toLowerCase() };
  }
  if (cjkChar.test(core)) {
    // Mixed-script token (CJK glued to non-CJK, e.g. "日本語abc"): ambiguous,
    // degrade to phrase — never a wrong single-word lookup. Documented
    // limitation for languages without word boundaries.
    return PHRASE;
  }
  if (!classify(core)) return PHRASE; // ambiguous → safe degradation
  return { kind: "word", word: core, queryWord: core.normalize("NFC").toLowerCase() };
}

/** Classify a settled selection (feature-detected implementation). */
export function resolveSelectionIntent(text: string | null | undefined): SelectionIntent {
  return resolveWith(defaultClassify, text);
}

/** Explicit classifier entry points (tests: parity between paths). */
export function resolveSelectionIntentUsingSegmenter(text: string | null | undefined): SelectionIntent {
  return resolveWith(classifyWithSegmenter, text);
}

export function resolveSelectionIntentUsingFallback(text: string | null | undefined): SelectionIntent {
  return resolveWith(classifyWithRegex, text);
}

export const selectionClassifierStatus = {
  segmenter: segmenterAvailable,
  propertyEscapes: propertyEscapesAvailable,
};

/**
 * Dictionary query for an EXPLICIT lookup (sheet row / context menu): word
 * selections use the resolver's normalized `queryWord`; phrase selections
 * (multi-word idioms like "fire drill") query the trimmed phrase itself.
 * Returns "" for `none`/`url` intents (no lookup possible).
 */
export function dictionaryQueryForText(raw: string | null | undefined): string {
  const intent = resolveSelectionIntent(raw);
  if (intent.kind === "word") return intent.queryWord;
  if (intent.kind === "phrase") {
    return trimSelectionEdges((raw ?? "").trim()).replace(/\s+/g, " ").toLowerCase();
  }
  return "";
}
