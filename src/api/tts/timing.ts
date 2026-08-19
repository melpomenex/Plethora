/**
 * Provider timing normalizers.
 *
 * Maps the character/token timestamp payloads that TTS APIs actually return
 * onto the chunk's word boundaries POSITIONALLY: the Nth payload token maps to
 * the Nth word of the chunk text, char indices resolve to the word whose
 * [normStart, normEnd) contains them. Word strings are never re-split or
 * searched for; a payload whose shape or alignment is not recognized yields
 * `undefined` so playback falls back to synthesized timings instead of
 * highlighting wrong words.
 *
 * Every timing produced here is real alignment data and is marked
 * `source: "measured"`.
 */

import type { WordTiming } from "../../utils/wordTimings";

/** Character span of a word inside the (already whitespace-normalized) chunk text. */
export interface WordCharSpan {
  start: number;
  end: number;
}

/**
 * Word char spans for a chunk of TTS text. Words are the whitespace-separated
 * tokens the speech index also uses, so payload tokens map 1:1 by position.
 */
export function computeWordCharSpans(text: string): WordCharSpan[] {
  const spans: WordCharSpan[] = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Binary search: the index of the word whose [start, end) span contains
 * `charIndex` (the last word starting at or before it). Used to map engine
 * boundary events (Web Speech `onboundary`, Android `onRangeStart`) onto the
 * chunk's word list without re-splitting the text.
 */
export function charIndexToWordIndex(text: string, charIndex: number): number {
  if (charIndex <= 0) return 0;
  const spans = computeWordCharSpans(text);
  if (spans.length === 0) return 0;
  let lo = 0;
  let hi = spans.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (spans[mid].start <= charIndex) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function foldWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ─── ElevenLabs ─────────────────────────────────────────────────────────────
// `POST /text-to-speech/{voice}/with-timestamps` returns
// `{ audio_base64, alignment: { characters, character_start_times_seconds,
//    character_end_times_seconds } }` with per-character seconds.

export interface ElevenLabsAlignmentPayload {
  alignment?: {
    characters?: unknown;
    character_start_times_seconds?: unknown;
    character_end_times_seconds?: unknown;
  };
}

export function normalizeElevenLabsTimestamps(
  text: string,
  payload: unknown,
): WordTiming[] | undefined {
  const alignment = (payload as ElevenLabsAlignmentPayload | undefined)?.alignment;
  if (!alignment || typeof alignment !== "object") return undefined;
  return normalizeCharacterAlignment(text, alignment);
}

/**
 * Shared character-alignment normalizer: arrays of characters plus per-char
 * start/end times (seconds or milliseconds — inferred from magnitude).
 */
export function normalizeCharacterAlignment(
  text: string,
  payload: unknown,
): WordTiming[] | undefined {
  const p = payload as {
    characters?: unknown;
    character_start_times_seconds?: unknown;
    character_end_times_seconds?: unknown;
  } | undefined;
  if (!p || !Array.isArray(p.characters)) return undefined;

  const characters = p.characters;
  const startsRaw = p.character_start_times_seconds;
  const endsRaw = p.character_end_times_seconds;
  if (!Array.isArray(startsRaw) || !Array.isArray(endsRaw)) return undefined;
  if (startsRaw.length !== characters.length || endsRaw.length !== characters.length) return undefined;

  const starts = startsRaw.map((v) => (isFiniteNumber(v) ? v : NaN));
  const ends = endsRaw.map((v) => (isFiniteNumber(v) ? v : NaN));
  if (starts.some((v) => Number.isNaN(v)) || ends.some((v) => Number.isNaN(v))) return undefined;

  // Documented unit is seconds (ElevenLabs). Guard against relays that echo
  // 100ns ticks: a chunk can never span 30 minutes.
  const maxSeen = Math.max(...starts, ...ends);
  if (maxSeen < 0 || maxSeen > 1000 * 60 * 30) return undefined;
  const startMs = starts.map((v) => v * 1000);
  const endMs = ends.map((v) => v * 1000);

  // The payload must correspond to this chunk's text. ElevenLabs echoes the
  // request text verbatim; anything else is an unknown shape.
  const echoed = foldWhitespace(characters.map((c) => String(c)).join(""));
  if (echoed !== foldWhitespace(text)) return undefined;

  return charTimesToWordTimings(text, startMs, endMs);
}

/**
 * Fold per-character times onto the chunk's word spans: a word starts when its
 * first character starts and ends when its last character ends. Characters
 * belonging to no word span (spaces) are skipped.
 */
export function charTimesToWordTimings(
  text: string,
  charStartMs: number[],
  charEndMs: number[],
): WordTiming[] | undefined {
  if (charStartMs.length !== charEndMs.length) return undefined;
  const spans = computeWordCharSpans(text);
  const timings: WordTiming[] = [];
  for (const span of spans) {
    if (span.end > charStartMs.length) return undefined;
    let start = charStartMs[span.start];
    let end = charEndMs[Math.max(span.start, span.end - 1)];
    if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
    if (end < start) end = start;
    timings.push({
      word: text.slice(span.start, span.end),
      start_ms: Math.round(start),
      end_ms: Math.round(end),
      source: "measured",
    });
  }
  return timings;
}

// ─── Azure-style word boundaries ────────────────────────────────────────────
// Azure Speech / openai-compatible relays may surface word boundary metadata:
// `[{ text, offset, duration }]` with offset/duration in 100-nanosecond ticks
// (the Azure Speech SDK unit) or milliseconds. Positional: boundary i ↔ word i.

export interface AzureWordBoundary {
  text?: unknown;
  offset?: unknown;
  duration?: unknown;
}

export function normalizeAzureWordBoundaries(
  text: string,
  payload: unknown,
): WordTiming[] | undefined {
  const boundaries = extractBoundaryArray(payload);
  if (!boundaries) return undefined;
  const spans = computeWordCharSpans(text);
  if (boundaries.length !== spans.length) return undefined;

  const timings: WordTiming[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const offset = b.offset;
    const duration = b.duration;
    if (!isFiniteNumber(offset) || !isFiniteNumber(duration) || duration < 0) return undefined;
    // Ticks (100ns) vs milliseconds: a chunk never exceeds ~30 min.
    const unitMs = offset > 1000 * 60 * 30 ? 1 / 10_000 : 1;
    const startMs = offset * unitMs;
    const endMs = startMs + duration * unitMs;
    timings.push({
      word: text.slice(spans[i].start, spans[i].end),
      start_ms: Math.round(startMs),
      end_ms: Math.round(endMs),
      source: "measured",
    });
  }
  return timings;
}

function extractBoundaryArray(payload: unknown): AzureWordBoundary[] | undefined {
  if (Array.isArray(payload)) return payload as AzureWordBoundary[];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["WordBoundaries", "wordBoundaries", "word_boundaries", "boundaries", "words"]) {
      if (Array.isArray(record[key])) return record[key] as AzureWordBoundary[];
    }
  }
  return undefined;
}

// ─── fal-style word timestamps ──────────────────────────────────────────────
// fal model JSON surfaces timing under a variety of keys, e.g.
// `{ words: [{ word, start, end }] }` with seconds. Only shapes whose token
// count matches the chunk are accepted.

export function normalizeFalTimestamps(
  text: string,
  rawOutput: unknown,
): WordTiming[] | undefined {
  if (!rawOutput || typeof rawOutput !== "object") return undefined;
  const record = rawOutput as Record<string, unknown>;
  for (const key of ["words", "word_timestamps", "timestamps", "wordTimings", "word_level_timestamps"]) {
    const candidate = record[key];
    const timings = normalizeWordTimestampList(text, candidate);
    if (timings) return timings;
  }
  return undefined;
}

/**
 * Word-level timestamp list: `[{ word|text, start|start_time|start_seconds,
 * end|end_time|end_seconds }]` in seconds (or milliseconds by magnitude).
 * Positional: entry i ↔ word i of the chunk.
 */
export function normalizeWordTimestampList(
  text: string,
  payload: unknown,
): WordTiming[] | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const spans = computeWordCharSpans(text);
  if (payload.length !== spans.length) return undefined;

  const timings: WordTiming[] = [];
  let maxSeen = 0;
  for (let i = 0; i < payload.length; i++) {
    const entry = payload[i] as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") return undefined;
    const start = firstFinite(entry, ["start", "start_time", "start_seconds", "start_ms", "from"]);
    const end = firstFinite(entry, ["end", "end_time", "end_seconds", "end_ms", "to"]);
    if (start === undefined || end === undefined || end < start || start < 0) return undefined;
    maxSeen = Math.max(maxSeen, start, end);
    timings.push({
      word: text.slice(spans[i].start, spans[i].end),
      start_ms: start,
      end_ms: end,
      source: "measured",
    });
  }

  // Documented unit is seconds; guard against 100ns-tick relays (no chunk
  // spans 30 minutes).
  if (maxSeen > 1000 * 60 * 30) return undefined;
  return timings.map((t) => ({
    word: t.word,
    start_ms: Math.round(t.start_ms * 1000),
    end_ms: Math.round(t.end_ms * 1000),
    source: "measured" as const,
  }));
}

function firstFinite(entry: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (isFiniteNumber(value)) return value;
  }
  return undefined;
}
