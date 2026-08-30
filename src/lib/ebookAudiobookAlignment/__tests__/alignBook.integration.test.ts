import { describe, expect, it } from "vitest";
import { alignBook } from "../alignBook";
import { fromSegments } from "../transcriptionAdapter";

describe("alignBook", () => {
  it("aligns every EPUB section when one synthetic audio chapter spans the book", () => {
    const timeline = fromSegments([
      { text: "The first section starts here.", startMs: 0, endMs: 1500 },
      { text: "The second section continues there.", startMs: 1500, endMs: 3200 },
    ], "fixture");

    const map = alignBook({
      ebookDocId: "ebook",
      audioDocId: "audio",
      ebookContentHash: "ebook-hash",
      audioContentHash: "audio-hash",
      chapters: [
        { href: "first.xhtml", label: "First", plainText: "The first section starts here." },
        { href: "second.xhtml", label: "Second", plainText: "The second section continues there." },
      ],
      audioChapters: [{ index: 0, title: "Chapter 1", startMs: 0, endMs: 3200 }],
      timeline,
    });

    expect(map.chapters).toHaveLength(1);
    expect(new Set(map.chapters[0]?.words.map((word) => word.locator.kind === "epub" && word.locator.chapterHref))).toEqual(
      new Set(["first.xhtml", "second.xhtml"]),
    );
  });
});
