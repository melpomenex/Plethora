/**
 * Shared per-word timing helpers for karaoke-style transcript highlighting.
 *
 * Two producers feed this: Groq word-level transcription (podcasts/audiobooks)
 * and YouTube caption tracks (json3 `tOffsetMs` / VTT inline cue timestamps).
 * Both normalize to `{ word, start_ms, end_ms }` so a single active-word lookup
 * serves every player.
 *
 * The renderer matches words to text POSITIONALLY — the Nth whitespace token of
 * the segment text is highlighted when word index N is active; word strings are
 * never compared. Producers must therefore keep
 * `text.split(/\s+/).filter(Boolean).length === wordTimings.length`.
 */

export interface WordTiming {
  word: string;
  start_ms: number;
  end_ms: number;
}

/**
 * Find the index (into `wordTimings`) of the word currently being spoken at
 * `currentTimeSec`.
 *
 * - Returns the word whose [start_ms, end_ms] contains the current time, with a
 *   sticky tolerance in the gap AFTER a word so the highlight doesn't flicker
 *   off between adjacent words. The tolerance is capped so it never reaches the
 *   NEXT word's start (otherwise tightly-packed words with no gap would keep the
 *   earlier word highlighted through the later one).
 * - If we're past the last word's end but still inside the segment, keeps the
 *   last word highlighted (don't blank out mid-sentence).
 * - Returns -1 when no word is active (e.g. before the first word, or no
 *   timings).
 */
export function findActiveWordIndex(
  wordTimings: WordTiming[] | undefined,
  currentTimeSec: number,
): number {
  if (!wordTimings || wordTimings.length === 0) return -1;
  const currentMs = currentTimeSec * 1000;
  for (let i = 0; i < wordTimings.length; i++) {
    const w = wordTimings[i];
    // The sticky window extends 200ms after this word's end, but is capped just
    // before the next word's start so we hand off cleanly when words are
    // back-to-back (the next word's start belongs to the next word, not this one).
    const nextStart = i + 1 < wordTimings.length ? wordTimings[i + 1].start_ms : Infinity;
    const toleranceEnd = w.end_ms + 200;
    // If the tolerance would reach the next word, hand off at nextStart (exclusive).
    const windowEnd = toleranceEnd >= nextStart ? nextStart - 1 : toleranceEnd;
    if (currentMs >= w.start_ms && currentMs <= windowEnd) {
      return i;
    }
  }
  if (currentMs > wordTimings[wordTimings.length - 1].end_ms) {
    return wordTimings.length - 1;
  }
  return -1;
}

/** Minimum share of a segment any single word is guaranteed, in ms. */
const MIN_WORD_MS = 60;

/**
 * APPROXIMATE per-word timings, derived by spreading a segment's own span across
 * its words — NOT measured data.
 *
 * Used only when a transcript carries no real word offsets (human-authored
 * caption tracks have none, unlike YouTube's ASR tracks). Callers must render
 * the result in a visually distinct, muted style so an estimate is never
 * mistaken for a measurement, and must never persist or upload it.
 *
 * Words are weighted by character length + 1 (the +1 charges every word for its
 * trailing space, so a run of short words isn't crushed to nothing). A per-word
 * floor is reserved *before* the weighted split so the floor can never push the
 * last word past the segment's end.
 */
export function synthesizeWordTimings(
  text: string,
  startSec: number,
  endSec: number,
): WordTiming[] {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const startMs = Math.round(startSec * 1000);
  const endMs = Math.round(endSec * 1000);
  const spanMs = endMs - startMs;
  if (!Number.isFinite(spanMs) || spanMs <= 0) return [];

  const weights = tokens.map((t) => t.length + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  // Reserve the floor up front; on very fast speech the floor alone can exhaust
  // the span, in which case every word simply gets an equal sliver.
  const floorTotal = Math.min(spanMs, MIN_WORD_MS * tokens.length);
  const flexible = spanMs - floorTotal;
  const floorEach = floorTotal / tokens.length;

  let cursor = startMs;
  return tokens.map((word, i) => {
    const duration = floorEach + (flexible * weights[i]) / totalWeight;
    const start = Math.round(cursor);
    cursor += duration;
    // Pin the final word to the segment end so rounding can't leave a gap.
    const end = i === tokens.length - 1 ? endMs : Math.round(cursor);
    return { word, start_ms: start, end_ms: Math.max(end, start + 1) };
  });
}

/**
 * Whether `wordTimings` can be safely rendered against `text`.
 *
 * The renderer is ordinal, so a count mismatch would highlight the wrong word
 * for the rest of the segment. Callers fall back to plain text when this fails.
 */
export function wordTimingsAlignWith(text: string, wordTimings: WordTiming[] | undefined): boolean {
  if (!wordTimings || wordTimings.length === 0) return false;
  return text.split(/\s+/).filter((t) => t.length > 0).length === wordTimings.length;
}
