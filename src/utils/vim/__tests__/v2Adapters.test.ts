import { describe, expect, it, vi } from "vitest";
import { orderDocumentRange, type EpubDocumentPosition, type PdfDocumentPosition } from "../documentModel";
import { EpubV2Adapter } from "../epubV2Adapter";
import { PdfV2Adapter } from "../pdfV2Adapter";
import type { EpubVimRuntime, PdfVimRuntime } from "../readerRuntimes";

const epubPosition = (spineIndex: number, textOffset: number, exact: string): EpubDocumentPosition => ({ kind: "epub", spineIndex, cfi: `cfi-${spineIndex}-${textOffset}`, textOffset, affinity: "forward", quote: { exact } });
const pdfPosition = (pageNumber: number, itemIndex: number, charOffset: number, exact: string): PdfDocumentPosition => ({ kind: "pdf", pageNumber, itemIndex, charOffset, affinity: "forward", quote: { exact } });

describe("V2 document adapters", () => {
  it("restores EPUB by quote fallback and snapshots exact per-spine CFI ranges", async () => {
    const documents = ["alpha beta", "gamma delta"].map((text, index) => new DOMParser().parseFromString(index === 0 ? `<p>alpha <em>beta</em> ﬁ <ruby>漢<rt>kan</rt></ruby></p>` : `<p>${text}</p>`, "text/html"));
    const listeners = new Set<(event: { kind: "content" | "geometry" | "destroyed"; spineIndex?: number }) => void>();
    const runtime: EpubVimRuntime = {
      documentId: "book", currentSpineIndex: () => 0, currentCfi: () => null, currentWindow: () => window,
      sections: documents.map((doc, spineIndex) => ({
        spineIndex, href: `${spineIndex}.xhtml`, load: async () => doc,
        cfiForElement: (_element, edge) => `cfi-${spineIndex}-element-${edge}`,
        cfiForTextOffset: (_element, offset) => `cfi-${spineIndex}-${offset}`,
        cfiForRange: async (start, end) => `range-${spineIndex}-${start}-${end}`,
      })),
      reveal: async () => {}, rangeFromCfi: () => null, cfiFromRange: () => "mounted-range",
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    const adapter = new EpubV2Adapter(runtime);
    const restored = await adapter.resolvePosition({ ...epubPosition(0, 99, "beta"), cfi: "stale" });
    expect(restored).toMatchObject({ textOffset: 6, quote: { exact: "beta" } });
    const snapshot = await adapter.snapshot(orderDocumentRange(epubPosition(1, 0, "gamma"), epubPosition(0, 0, "alpha")));
    expect(snapshot.range.direction).toBe("backward"); expect(snapshot.text).toContain("alpha beta"); expect(snapshot.text).toContain("gamma");
    expect(snapshot.selectionContext).toMatchObject({ type: "epub", cfiRanges: [expect.stringMatching(/^range-0-/), "range-1-0-5"] });
    adapter.dispose();
  });

  it("snapshots virtualized PDF pages with logical PDF rectangles", async () => {
    const listener = vi.fn();
    const runtime: PdfVimRuntime = {
      documentId: "pdf", pageCount: 2, currentPageNumber: () => 1,
      loadPageText: async (page) => [{ str: page === 1 ? "alpha beta" : "gamma delta", transform: [1, 0, 0, 10, 20, 30], width: 50, height: 10 }],
      revealPage: async () => {}, textLayer: () => null, pageSelectionContext: () => null,
      subscribe: () => () => {},
    };
    const adapter = new PdfV2Adapter(runtime); adapter.subscribeInvalidation(listener);
    const snapshot = await adapter.snapshot(orderDocumentRange(pdfPosition(1, 0, 0, "alpha"), pdfPosition(2, 0, 0, "gamma")));
    expect(snapshot.text).toContain("alpha beta"); expect(snapshot.text).toContain("gamma");
    expect(snapshot.selectionContext).toMatchObject({ type: "pdf", pages: [
      { pageNumber: 1, pdfRects: [{ x1: 20, y1: 30, x2: 70, y2: 40 }] },
      { pageNumber: 2, pdfRects: [{ x1: 20, y1: 30, x2: 70, y2: 40 }] },
    ] });
    adapter.dispose();
  });

  it("reports an honest unavailable capability for image-only PDF pages", async () => {
    const runtime: PdfVimRuntime = { documentId: "scan", pageCount: 1, currentPageNumber: () => 1, loadPageText: async () => [], revealPage: async () => {}, textLayer: () => null, pageSelectionContext: () => null, subscribe: () => () => {} };
    await expect(new PdfV2Adapter(runtime).capabilities()).resolves.toMatchObject({ textNavigation: false, reasonUnavailable: expect.stringContaining("no spatially mapped text") });
  });
});
