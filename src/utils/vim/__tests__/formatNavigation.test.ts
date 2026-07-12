import { describe, expect, it } from "vitest";
import { EpubLogicalIndex } from "../epubLogicalIndex";
import { moveEpubPosition, movePdfPosition } from "../formatNavigation";
import { PdfLogicalIndex } from "../pdfLogicalIndex";

describe("format-aware Vim navigation", () => {
  it("moves EPUB positions across spine sections with count", async () => {
    const index = new EpubLogicalIndex([0, 1].map((spineIndex) => ({
      spineIndex,
      href: `${spineIndex}.xhtml`,
      load: async () => `<p>${spineIndex === 0 ? "one two" : "three four"}</p>`,
      cfiForElement: (_element: Element, edge: "start" | "end") => `epubcfi(/6/${spineIndex + 2}:${edge})`,
    })));
    const moved = await moveEpubPosition(index, {
      kind: "epub", spineIndex: 0, cfi: "epubcfi(/6/2:start)", textOffset: 0, affinity: "forward",
    }, { motion: "word-forward", count: 2, desiredX: null }, 0, 1);
    expect(moved.position).toMatchObject({ spineIndex: 1, textOffset: 0, quote: { exact: "three" } });
  });

  it("moves PDF positions across pages and preserves desired column", async () => {
    const index = new PdfLogicalIndex(async (page) => page === 1
      ? [{ str: "one two", hasEOL: true }]
      : [{ str: "three four", hasEOL: true }]);
    const moved = await movePdfPosition(index, {
      kind: "pdf", pageNumber: 1, itemIndex: 1, charOffset: 4, affinity: "forward",
    }, { motion: "word-forward", count: 1, desiredX: 1 }, 2);
    expect(moved.position).toMatchObject({ pageNumber: 2, itemIndex: 0, quote: { exact: "three" } });
    expect(moved.desiredX).toBe(1);
  });
});
