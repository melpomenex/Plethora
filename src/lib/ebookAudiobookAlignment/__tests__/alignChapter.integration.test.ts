import { describe, expect, it } from "vitest";
import { alignChapter } from "../alignChapter";
import { fromSegments } from "../transcriptionAdapter";
import { PlaybackLookup } from "../playbackLookup";

describe("alignChapter integration", () => {
  it("aligns fixture ebook to synthetic transcript end-to-end", () => {
    const ebookText = "It was the best of times. It was the worst of times.";
    const segments = [
      { text: "It was the best of times.", startMs: 0, endMs: 2000, confidence: 0.9 },
      { text: "It was the worst of times.", startMs: 2000, endMs: 4500, confidence: 0.9 },
    ];
    const timeline = fromSegments(segments, "fixture");

    const chapter = alignChapter({
      chapter: { href: "ch1.xhtml", label: "Chapter 1", plainText: ebookText },
      audioChapter: { index: 0, title: "Chapter 1", startMs: 0, endMs: 5000 },
      timeline,
    });

    expect(chapter.words.length).toBeGreaterThan(5);
    expect(chapter.chapterConfidence).toBeGreaterThan(0.5);

    const lookup = new PlaybackLookup({
      version: 2,
      pairId: "t",
      ebookDocId: "e",
      audioDocId: "a",
      ebookContentHash: "h",
      audioContentHash: "h2",
      transcriptFingerprint: timeline.fingerprint,
      granularity: "word",
      createdAt: "",
      updatedAt: "",
      overallConfidence: chapter.chapterConfidence,
      chapters: [chapter],
    });

    const at1500 = lookup.findWordAtTime(1500);
    expect(at1500?.word.text.toLowerCase()).toMatch(/times|best|of/);
  });
});
