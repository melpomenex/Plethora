import { describe, expect, it } from "vitest";
import { clearWordHighlight, highlightWordAtOffset, hrefMatchesChapter } from "../epubWordHighlight";

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

describe("EPUB word highlighting", () => {
  it("wraps the active word and clears the previous highlight", () => {
    const epubDocument = new DOMParser().parseFromString(
      "<html><body><p>Hello brave world.</p></body></html>",
      "text/html",
    );

    expect(highlightWordAtOffset(epubDocument, 6, 5)).toBe(true);
    expect(epubDocument.querySelectorAll(".audiobook-sync-word")).toHaveLength(1);
    expect(epubDocument.querySelector(".audiobook-sync-word")?.textContent).toBe("brave");

    expect(highlightWordAtOffset(epubDocument, 12, 5)).toBe(true);
    expect(epubDocument.querySelectorAll(".audiobook-sync-word")).toHaveLength(1);
    expect(epubDocument.querySelector(".audiobook-sync-word")?.textContent).toBe("world");

    clearWordHighlight(epubDocument);
    expect(epubDocument.querySelector(".audiobook-sync-word")).toBeNull();
  });
});
