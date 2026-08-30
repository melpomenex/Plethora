import { describe, expect, it } from "vitest";
import { buildTimedTextMapFromTtsChunk } from "../fromTtsChunk";
import type { TTSChunk } from "../../../utils/readerSpeechIndex";

describe("buildTimedTextMapFromTtsChunk", () => {
  const chunk: TTSChunk = {
    index: 0,
    text: "Hello world",
    sectionKey: "ch1",
    words: [
      {
        text: "Hello",
        anchor: { kind: "epub", spineIndex: 0, sectionOffset: 0 },
        normStart: 0,
        normEnd: 5,
        sectionOffset: 0,
      },
      {
        text: "world",
        anchor: { kind: "epub", spineIndex: 0, sectionOffset: 6 },
        normStart: 6,
        normEnd: 11,
        sectionOffset: 6,
      },
    ],
  };

  it("maps timings to locators positionally", () => {
    const map = buildTimedTextMapFromTtsChunk({
      documentId: "doc-1",
      chunk,
      timings: [
        { word: "Hello", start_ms: 0, end_ms: 300, source: "measured" },
        { word: "world", start_ms: 300, end_ms: 600, source: "measured" },
      ],
    });
    expect(map?.entries).toHaveLength(2);
    expect(map?.entries[0].locator).toEqual({ kind: "epub-spine", spineIndex: 0, sectionOffset: 0 });
    expect(map?.entries[1].wordIndex).toBe(1);
    expect(map?.sourceType).toBe("generated_tts");
  });

  it("returns null when timing count mismatches", () => {
    const map = buildTimedTextMapFromTtsChunk({
      documentId: "doc-1",
      chunk,
      timings: [{ word: "Hello", start_ms: 0, end_ms: 300 }],
    });
    expect(map).toBeNull();
  });
});
