/**
 * Timing-source fidelity and playback-clock commit tests:
 * - synthesized timings are always marked `source: "synthesized"`
 * - measured timings win when they align, and are discarded when they don't
 * - the clock commit gate (`nextActiveWordIndex`) commits ~once per word, not
 *   per frame (simulating a rAF sampling loop over several frames)
 */

import { describe, expect, it } from "vitest";
import {
  nextActiveWordIndex,
  resolveChunkTimings,
  synthesizeWordTimings,
  wordTimingsAlignWith,
} from "../wordTimings";

const CHUNK = "alpha beta gamma delta epsilon zeta";

describe("synthesizeWordTimings source fidelity", () => {
  it("marks every synthesized timing as synthesized", () => {
    const timings = synthesizeWordTimings(CHUNK, 0, 6);
    expect(timings.length).toBe(6);
    for (const t of timings) expect(t.source).toBe("synthesized");
  });
});

describe("resolveChunkTimings", () => {
  it("prefers measured timings when they align with the chunk text", () => {
    const measured = CHUNK.split(/\s+/).map((w, i) => ({
      word: w,
      start_ms: i * 500,
      end_ms: i * 500 + 400,
      source: "measured" as const,
    }));
    const resolved = resolveChunkTimings(CHUNK, measured, 3.2);
    expect(resolved).toBe(measured);
  });

  it("falls back to synthesized timings over the real duration when measured is missing", () => {
    const resolved = resolveChunkTimings(CHUNK, undefined, 3.2);
    expect(resolved).toBeDefined();
    expect(resolved!.every((t) => t.source === "synthesized")).toBe(true);
  });

  it("discards misaligned measured timings (wrong word count) instead of highlighting wrong words", () => {
    const misaligned = [
      { word: "x", start_ms: 0, end_ms: 100, source: "measured" as const },
      { word: "y", start_ms: 100, end_ms: 200, source: "measured" as const },
    ];
    expect(wordTimingsAlignWith(CHUNK, misaligned)).toBe(false);
    const resolved = resolveChunkTimings(CHUNK, misaligned, 4);
    expect(resolved).toBeDefined();
    expect(resolved!.every((t) => t.source === "synthesized")).toBe(true);
  });

  it("returns undefined while duration is still unknown", () => {
    expect(resolveChunkTimings(CHUNK, undefined, undefined)).toBeUndefined();
    expect(resolveChunkTimings(CHUNK, undefined, NaN)).toBeUndefined();
  });
});

describe("nextActiveWordIndex (clock commit gate)", () => {
  const timings = synthesizeWordTimings(CHUNK, 0, 6); // 6 words over 6s ≈ 1s/word

  it("commits only when the active word changes across sampled frames", () => {
    // Simulate 60 frames covering the first two words (16ms each).
    let last = -1;
    const commits: number[] = [];
    for (let frame = 0; frame < 64; frame++) {
      const t = frame * 0.016;
      const next = nextActiveWordIndex(timings, t, last);
      if (next !== null) {
        last = next;
        commits.push(next);
      }
    }
    // One commit per word boundary crossed (~word 0 and word 1), not per frame.
    expect(commits.length).toBeLessThanOrEqual(3);
    expect(commits[0]).toBe(0);
    expect(commits).toContain(1);
  });

  it("returns null before speech starts and for unchanged words", () => {
    expect(nextActiveWordIndex(timings, -1, -1)).toBeNull();
    // Comfortably inside word 0's window.
    const insideWord0 = (timings[0].start_ms + 10) / 1000;
    expect(nextActiveWordIndex(timings, insideWord0, 0)).toBeNull();
  });

  it("hands off to the next word when its start is reached", () => {
    let last = 0;
    const next = nextActiveWordIndex(timings, timings[1].start_ms / 1000, last);
    expect(next).toBe(1);
    last = next;
    expect(nextActiveWordIndex(timings, (timings[1].start_ms + 20) / 1000, last)).toBeNull();
  });
});
