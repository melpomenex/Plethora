import {
  fallbackTokenMatches,
  graphemeBoundaries,
  normalizeForLookup,
  safeUtf16End,
  scriptMetadata,
  splitTextIntoChunks,
  wordSegments,
} from "../unicode";

describe("language processing Unicode utilities", () => {
  it("normalizes decomposed accents without changing source length", () => {
    const decomposed = "e\u0301lan";
    expect(normalizeForLookup(decomposed, "fr")).toBe("élan");
    expect(decomposed.slice(0, 2)).toBe("e\u0301");
    expect(graphemeBoundaries(decomposed)).toEqual([0, 2, 3, 4, 5]);
  });

  it("does not split surrogate pairs or grapheme clusters at chunk boundaries", () => {
    const text = "A😀e\u0301B";
    expect(safeUtf16End(text, 2)).toBe(1);
    const chunks = splitTextIntoChunks(text, 2);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true);
  });

  it("segments CJK without collapsing a paragraph into one fake word", () => {
    const segments = wordSegments("日本語を読む。", "ja");
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map((part) => part.segment).join("")).toBe("日本語を読む。");
    expect(fallbackTokenMatches("日本語を読む").length).toBeGreaterThan(1);
  });

  it("retains RTL and mixed-script metadata", () => {
    expect(scriptMetadata("العربية")).toMatchObject({ script: "arabic", direction: "rtl" });
    expect(scriptMetadata("hello العربية")).toMatchObject({ script: "mixed", direction: "mixed" });
    expect(scriptMetadata("مرحبا").direction).toBe("rtl");
  });

  it("keeps apostrophes, hyphens, punctuation, and emoji source-safe", () => {
    const text = "l’esprit mère-in-law! 😀";
    const segments = wordSegments(text, "fr");
    expect(segments.map((part) => part.segment)).toContain("l’esprit");
    expect(segments.map((part) => part.segment)).toContain("mère-in-law");
    expect(segments.map((part) => part.segment)).toContain("!");
    for (const part of segments) expect(text.slice(part.start, part.end)).toBe(part.segment);
  });
});
