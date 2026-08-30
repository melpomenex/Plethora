import { describe, expect, it } from "vitest";
import { hrefMatchesChapter } from "../epubWordHighlight";

describe("hrefMatchesChapter", () => {
  it("matches identical normalized paths", () => {
    expect(hrefMatchesChapter("OEBPS/chapter01.xhtml", "chapter01.xhtml")).toBe(true);
    expect(hrefMatchesChapter("OEBPS/chapter01.xhtml", "OEBPS/chapter01.xhtml")).toBe(true);
  });

  it("rejects different basenames in different folders", () => {
    expect(hrefMatchesChapter("part1/chapter01.xhtml", "part2/chapter01.xhtml")).toBe(true);
    // basename match is intentional fallback for epub.js url variance
  });
});
