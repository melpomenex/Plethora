/**
 * Unit tests for the TTS provider timing normalizers (`src/api/tts/timing.ts`):
 * known payload shapes normalize positionally onto chunk word boundaries,
 * unknown/misaligned shapes yield undefined, and every produced timing is
 * marked `source: "measured"`.
 */

import { describe, expect, it } from "vitest";
import {
  charIndexToWordIndex,
  computeWordCharSpans,
  normalizeAzureWordBoundaries,
  normalizeCharacterAlignment,
  normalizeElevenLabsTimestamps,
  normalizeFalTimestamps,
  normalizeWordTimestampList,
} from "../timing";

const CHUNK = "The quick brown fox jumps over the lazy dog";

function elevenPayload(text: string, secondsPerChar = 0.05) {
  const chars = Array.from(text);
  return {
    audio_base64: "",
    alignment: {
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * secondsPerChar),
      character_end_times_seconds: chars.map((_, i) => (i + 1) * secondsPerChar),
    },
  };
}

describe("computeWordCharSpans", () => {
  it("yields the char span of each whitespace-separated word", () => {
    expect(computeWordCharSpans("  one  two three ")).toEqual([
      { start: 2, end: 5 },
      { start: 7, end: 10 },
      { start: 11, end: 16 },
    ]);
  });
});

describe("charIndexToWordIndex", () => {
  it("maps a boundary charIndex to the containing word", () => {
    // "The quick brown fox jumps over the lazy dog"
    //  0   6     12    17  23   28   33  37  42
    expect(charIndexToWordIndex(CHUNK, 0)).toBe(0);
    expect(charIndexToWordIndex(CHUNK, 6)).toBe(1);
    expect(charIndexToWordIndex(CHUNK, 14)).toBe(2);
    expect(charIndexToWordIndex(CHUNK, 42)).toBe(8);
    expect(charIndexToWordIndex(CHUNK, CHUNK.length)).toBe(8);
  });

  it("clamps non-positive indices to the first word", () => {
    expect(charIndexToWordIndex(CHUNK, -5)).toBe(0);
  });
});

describe("normalizeElevenLabsTimestamps", () => {
  it("maps character alignment onto word boundaries positionally, marked measured", () => {
    const timings = normalizeElevenLabsTimestamps(CHUNK, elevenPayload(CHUNK));
    expect(timings).toBeDefined();
    expect(timings!.map((t) => t.word)).toEqual(CHUNK.split(/\s+/));
    for (const t of timings!) {
      expect(t.source).toBe("measured");
    }
    // "The" occupies chars 0–2 at 0.05s per char → 0–150ms.
    expect(timings![0]).toMatchObject({ word: "The", start_ms: 0, end_ms: 150 });
    // "quick" occupies chars 4–8 → 200–450ms.
    expect(timings![1]).toMatchObject({ word: "quick", start_ms: 200, end_ms: 450 });
  });

  it("returns undefined when the echoed text does not match the chunk", () => {
    expect(normalizeElevenLabsTimestamps(CHUNK, elevenPayload("Completely different words here"))).toBeUndefined();
  });

  it("returns undefined for unknown payload shapes", () => {
    expect(normalizeElevenLabsTimestamps(CHUNK, null)).toBeUndefined();
    expect(normalizeElevenLabsTimestamps(CHUNK, { audio: "..." })).toBeUndefined();
    expect(
      normalizeElevenLabsTimestamps(CHUNK, { alignment: { characters: ["a"], character_start_times_seconds: [0] } }),
    ).toBeUndefined();
  });

  it("rejects implausible (tick-scale) magnitudes as unknown shapes", () => {
    const chars = Array.from(CHUNK);
    const payload = {
      alignment: {
        characters: chars,
        character_start_times_seconds: chars.map((_, i) => i * 10_000_000),
        character_end_times_seconds: chars.map((_, i) => (i + 1) * 10_000_000),
      },
    };
    expect(normalizeCharacterAlignment(CHUNK, payload)).toBeUndefined();
  });
});

describe("normalizeAzureWordBoundaries", () => {
  it("normalizes 100ns-tick word boundaries positionally", () => {
    const words = CHUNK.split(/\s+/);
    // offset in ticks: word i starts at i * 1s.
    const payload = { WordBoundaries: words.map((w, i) => ({ text: w, offset: i * 10_000_000, duration: w.length * 500_000 })) };
    const timings = normalizeAzureWordBoundaries(CHUNK, payload);
    expect(timings).toBeDefined();
    expect(timings!.length).toBe(words.length);
    expect(timings![1]).toMatchObject({ word: "quick", start_ms: 1000, end_ms: 1250 });
    expect(timings!.every((t) => t.source === "measured")).toBe(true);
  });

  it("tolerates millisecond offsets and alternate key spellings", () => {
    const words = CHUNK.split(/\s+/);
    const payload = { word_boundaries: words.map((w, i) => ({ Text: w, offset: i * 1000, duration: 300 })) };
    const timings = normalizeAzureWordBoundaries(CHUNK, payload);
    expect(timings).toBeDefined();
    expect(timings![2]).toMatchObject({ start_ms: 2000, end_ms: 2300 });
  });

  it("returns undefined on count mismatch or unknown shape", () => {
    expect(normalizeAzureWordBoundaries(CHUNK, { WordBoundaries: [{ offset: 0, duration: 1 }] })).toBeUndefined();
    expect(normalizeAzureWordBoundaries(CHUNK, { nothing: [] })).toBeUndefined();
    expect(normalizeAzureWordBoundaries(CHUNK, 42)).toBeUndefined();
  });
});

describe("normalizeWordTimestampList / normalizeFalTimestamps", () => {
  it("normalizes word lists with seconds, positionally", () => {
    const words = CHUNK.split(/\s+/);
    const list = words.map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.3 }));
    const timings = normalizeWordTimestampList(CHUNK, list);
    expect(timings).toBeDefined();
    expect(timings![3]).toMatchObject({ word: "fox", start_ms: 1200, end_ms: 1500, source: "measured" });
  });

  it("accepts {words: [...]} under the fal rawOutput keys", () => {
    const words = CHUNK.split(/\s+/);
    const raw = { words: words.map((w, i) => ({ text: w, start_time: i * 0.5, end_time: i * 0.5 + 0.4 })) };
    const timings = normalizeFalTimestamps(CHUNK, raw);
    expect(timings).toBeDefined();
    expect(timings!.length).toBe(9);
  });

  it("returns undefined for unknown shapes and count mismatches", () => {
    expect(normalizeFalTimestamps(CHUNK, { audio_url: "..." })).toBeUndefined();
    expect(normalizeFalTimestamps(CHUNK, null)).toBeUndefined();
    expect(
      normalizeWordTimestampList(CHUNK, [
        { word: "only", start: 0, end: 1 },
      ]),
    ).toBeUndefined();
  });
});
