import type { AlignedWord } from "./types";

/**
 * Fill timestamps for words missing direct hyp alignment (DELETE ops, gaps).
 * Length-weighted interpolation between known anchors — inspired by
 * Storyteller interpolateSentenceRanges.
 */
export function interpolateWordTimestamps(
  words: AlignedWord[],
  chapterStartMs: number,
  chapterEndMs: number,
): void {
  if (words.length === 0) return;

  const anchors: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!words[i].interpolated && words[i].endMs > words[i].startMs) {
      anchors.push(i);
    }
  }

  if (anchors.length === 0) {
    const span = chapterEndMs - chapterStartMs;
    const weight = words.reduce((s, w) => s + Math.max(1, w.text.length), 0);
    let cursor = chapterStartMs;
    for (const w of words) {
      const dur = (span * Math.max(1, w.text.length)) / weight;
      w.startMs = cursor;
      w.endMs = cursor + dur;
      w.interpolated = true;
      w.confidence = Math.min(w.confidence, 0.35);
      cursor += dur;
    }
    return;
  }

  // Leading gap
  const first = anchors[0];
  if (first > 0) {
    fillGap(words, 0, first, chapterStartMs, words[first].startMs);
  }

  for (let a = 0; a < anchors.length - 1; a++) {
    const left = anchors[a];
    const right = anchors[a + 1];
    if (right - left > 1) {
      fillGap(words, left + 1, right, words[left].endMs, words[right].startMs);
    }
  }

  const last = anchors[anchors.length - 1];
  if (last < words.length - 1) {
    fillGap(words, last + 1, words.length, words[last].endMs, chapterEndMs);
  }
}

function fillGap(
  words: AlignedWord[],
  startIdx: number,
  endIdx: number,
  startMs: number,
  endMs: number,
): void {
  const slice = words.slice(startIdx, endIdx);
  if (slice.length === 0) return;
  const span = Math.max(0, endMs - startMs);
  const weight = slice.reduce((s, w) => s + Math.max(1, w.text.length), 0);
  let cursor = startMs;
  for (const w of slice) {
    const dur = weight > 0 ? (span * Math.max(1, w.text.length)) / weight : 0;
    w.startMs = cursor;
    w.endMs = cursor + dur;
    w.interpolated = true;
    w.confidence = Math.min(w.confidence, 0.4);
    cursor += dur;
  }
}

/** Ensure non-overlapping, forward-moving timestamps after interpolation. */
export function enforceMonotonicTimestamps(words: AlignedWord[], minDurationMs = 20): void {
  let prevEnd = 0;
  for (const w of words) {
    if (w.startMs < prevEnd) w.startMs = prevEnd;
    if (w.endMs <= w.startMs) w.endMs = w.startMs + minDurationMs;
    prevEnd = w.endMs;
  }
}
