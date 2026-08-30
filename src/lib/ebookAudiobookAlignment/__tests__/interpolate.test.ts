import { describe, expect, it } from "vitest";
import { enforceMonotonicTimestamps, interpolateWordTimestamps } from "../interpolate";
import type { AlignedWord } from "../types";

function word(startMs: number, endMs: number, interpolated = false): AlignedWord {
  return {
    text: "x",
    locator: { kind: "epub", chapterHref: "ch1", charOffset: 0 },
    startMs,
    endMs,
    confidence: 0.9,
    interpolated,
    op: "match",
  };
}

describe("enforceMonotonicTimestamps", () => {
  it("fixes overlapping interpolated timestamps", () => {
    const words = [word(0, 500), word(400, 800, true), word(700, 1200)];
    interpolateWordTimestamps(words, 0, 2000);
    enforceMonotonicTimestamps(words);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].endMs);
    }
  });
});
