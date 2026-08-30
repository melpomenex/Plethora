import { describe, expect, it } from "vitest";
import { PlaybackLookup } from "../playbackLookup";
import type { PlethoraAlignmentMap } from "../types";

function makeMap(words: Array<{ startMs: number; endMs: number; text: string; offset?: number }>): PlethoraAlignmentMap {
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
          locator: { kind: "epub" as const, chapterHref: "ch1", charOffset: w.offset ?? i * 5 },
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

describe("PlaybackLookup catch-up", () => {
  it("skips multiple words when time jumps forward", () => {
    const lookup = new PlaybackLookup(
      makeMap([
        { text: "a", startMs: 0, endMs: 100 },
        { text: "b", startMs: 100, endMs: 200 },
        { text: "c", startMs: 200, endMs: 300 },
        { text: "d", startMs: 300, endMs: 400 },
      ]),
    );
    lookup.advance(50);
    expect(lookup.advance(350)?.word.text).toBe("d");
  });

  it("finds word by char offset for tap-to-seek", () => {
    const lookup = new PlaybackLookup(
      makeMap([
        { text: "hello", startMs: 0, endMs: 500, offset: 0 },
        { text: "world", startMs: 500, endMs: 1000, offset: 6 },
      ]),
    );
    expect(lookup.findWordByCharOffset("ch1", 7)?.text).toBe("world");
  });
});
