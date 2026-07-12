import { describe, expect, it, vi } from "vitest";
import { EpubLogicalIndex } from "../epubLogicalIndex";
import { BoundedRegionCache, buildLogicalRegion, normalizeLogicalText } from "../logicalIndex";
import { groupPdfItemsIntoLines, PdfLogicalIndex, sortPdfItemsReadingOrder } from "../pdfLogicalIndex";

describe("logical document indexes", () => {
  it("normalizes soft hyphens and whitespace while preserving blocks", () => {
    expect(normalizeLogicalText("  inter\u00adnational  book\n text ")).toBe("international book text");
    const region = buildLogicalRegion("chapter", ["One, two", "Three"]);
    expect(region.text).toBe("One, two\nThree");
    expect(region.tokens.map((token) => [token.text, token.kind])).toEqual([
      ["One", "word"], [",", "punct"], ["two", "word"], ["Three", "word"],
    ]);
    expect(region.blocks[1].startOffset).toBe(region.blocks[0].endOffset + 1);
  });

  it("evicts the least recently used logical region", () => {
    const cache = new BoundedRegionCache<number, string>(2);
    cache.set(1, "one"); cache.set(2, "two"); cache.get(1); cache.set(3, "three");
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
    expect(cache.has(3)).toBe(true);
  });

  it("loads and caches EPUB sections lazily from semantic blocks", async () => {
    const load = vi.fn(async () => "<html><body><h1>Chapter</h1><p>Nested <em>words</em>.</p></body></html>");
    const index = new EpubLogicalIndex([{
      spineIndex: 0,
      href: "one.xhtml",
      load,
      cfiForElement: (element, edge) => `epubcfi(${element.tagName.toLowerCase()}:${edge})`,
    }]);
    const first = await index.section(0);
    const second = await index.section(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first?.href).toBe("one.xhtml");
    expect(first?.blocks.map((block) => block.text)).toEqual(["Chapter", "Nested words."]);
    expect(first?.cfiBoundaries).toEqual([
      { blockIndex: 0, startCfi: "epubcfi(h1:start)", endCfi: "epubcfi(h1:end)" },
      { blockIndex: 1, startCfi: "epubcfi(p:start)", endCfi: "epubcfi(p:end)" },
    ]);
  });

  it("groups PDF items by geometry and explicit line endings", () => {
    const lines = groupPdfItemsIntoLines([
      { str: "One ", transform: [1, 0, 0, 1, 0, 100] },
      { str: "line", transform: [1, 0, 0, 1, 20, 100], hasEOL: true },
      { str: "Next", transform: [1, 0, 0, 1, 0, 80] },
    ]);
    expect(lines.map((line) => line.map((item) => item.str).join(""))).toEqual(["One line", "Next"]);
  });

  it("loads PDF text independently of mounted text layers and caches pages", async () => {
    const load = vi.fn(async () => [
      { str: "Hello ", transform: [1, 0, 0, 1, 0, 50] },
      { str: "PDF", transform: [1, 0, 0, 1, 30, 50] },
    ]);
    const index = new PdfLogicalIndex(load);
    expect((await index.page(4)).text).toBe("Hello PDF");
    expect((await index.page(4)).tokens.map((token) => token.text)).toEqual(["Hello", "PDF"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("orders a two-column PDF down the left column before the right", () => {
    const ordered = sortPdfItemsReadingOrder([
      { str: "L1", transform: [1,0,0,1,10,100] }, { str: "R1", transform: [1,0,0,1,310,100] },
      { str: "L2", transform: [1,0,0,1,10,80] }, { str: "R2", transform: [1,0,0,1,310,80] },
    ]);
    expect(ordered.map((item) => item.str)).toEqual(["L1", "L2", "R1", "R2"]);
  });
});
