import { describe, expect, it } from "vitest";
import { PlaybackLookup } from "../playbackLookup";
import type { PlethoraAlignmentMap } from "../types";

function makeMap(words: Array<{ startMs: number; endMs: number; text: string }>): PlethoraAlignmentMap {
  return {
    version: 2,
    pairId: "test",
    ebookDocId: "e1",
    audioDocId: "a1",
    ebookContentHash: "h1",
    audioContentHash: "h2",
    transcriptFingerprint: "t1",
    granularity: "word",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    overallConfidence: 0.9,
    chapters: [
      {
        ebookChapterHref: "ch1",
        audioChapterIndex: 0,
        audioStartMs: 0,
        audioEndMs: 10000,
        chapterConfidence: 0.9,
        status: "complete",
        words: words.map((w, i) => ({
          text: w.text,
          locator: { kind: "epub" as const, chapterHref: "ch1", charOffset: i * 5 },
          startMs: w.startMs,
          endMs: w.endMs,
          confidence: 0.9,
          interpolated: false,
          op: "match" as const,
        })),
      },
    ],
  };
}

describe("PlaybackLookup", () => {
  it("finds word at time via binary search", () => {
    const lookup = new PlaybackLookup(
      makeMap([
        { text: "a", startMs: 0, endMs: 500 },
        { text: "b", startMs: 500, endMs: 1000 },
        { text: "c", startMs: 1000, endMs: 1500 },
      ]),
    );
    expect(lookup.findWordAtTime(600)?.word.text).toBe("b");
    expect(lookup.findWordAtTime(1200)?.word.text).toBe("c");
  });

  it("advances cursor during forward playback", () => {
    const lookup = new PlaybackLookup(
      makeMap([
        { text: "a", startMs: 0, endMs: 500 },
        { text: "b", startMs: 500, endMs: 1000 },
      ]),
    );
    expect(lookup.advance(100)?.word.text).toBe("a");
    expect(lookup.advance(600)?.word.text).toBe("b");
  });

  it("recovers after large seek", () => {
    const words = Array.from({ length: 100 }, (_, i) => ({
      text: `w${i}`,
      startMs: i * 100,
      endMs: (i + 1) * 100,
    }));
    const lookup = new PlaybackLookup(makeMap(words));
    lookup.advance(50);
    expect(lookup.findWordAtTime(7500)?.word.text).toBe("w75");
  });
});
