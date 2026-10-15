import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { HighlightLayer, type StoredHighlight } from "../HighlightLayer";
import { MarkdownViewer } from "../MarkdownViewer";
import { applyAnchoredTextHighlights } from "../../../utils/textHighlights";
import { epubAnnotationTargetsAtPoint, renderedAnnotationTargetsAtPoint, textAnnotationTargetsAtPoint, type SavedAnnotationTarget } from "../annotationContextMenu";
import type { PageViewport } from "pdfjs-dist";
import type { Document as ReaderDocument } from "../../../types";

const target = (extractId: string): SavedAnnotationTarget => ({ extractId, documentId: "doc", text: "same passage" });
const rect = (left = 10, top = 20, width = 100, height = 12) => new DOMRect(left, top, width, height);
function geometry(element: Element, box = rect()) {
  vi.spyOn(element, "getClientRects").mockReturnValue([box] as unknown as DOMRectList);
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.getSelection()?.removeAllRanges(); });

describe("saved annotation identity and geometry", () => {
  it("preserves both overlapping text records and repaints the survivor on removal", () => {
    const root = document.createElement("div");
    root.textContent = "abcdefghij";
    const a = { id: "a", annotation: target("a"), startOffset: 0, endOffset: 6 };
    const b = { id: "b", annotation: target("b"), startOffset: 3, endOffset: 10 };
    applyAnchoredTextHighlights({ root, highlights: [a, b], signature: "text" });
    const marks = root.querySelectorAll("mark");
    geometry(marks[1]);
    expect(textAnnotationTargetsAtPoint(root, [a, b], 20, 25).map((t) => t.extractId)).toEqual(["a", "b"]);
    applyAnchoredTextHighlights({ root, highlights: [b], signature: "text" });
    expect(root.textContent).toBe("abcdefghij");
    expect(root.querySelector("mark")?.textContent).toBe("defghij");
    expect(root.querySelector("mark")?.dataset.highlightId).toBe("b");
    applyAnchoredTextHighlights({ root, highlights: [], signature: "text" });
    expect(root.querySelector("mark")).toBeNull();
    expect(root.textContent).toBe("abcdefghij");
  });

  it("resolves marks from another document realm and ignores search/unowned marks", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const root = frame.contentDocument!.body;
    root.innerHTML = '<mark data-highlight-id="a">saved</mark><mark data-search-highlight="true">search</mark>';
    geometry(root.firstElementChild!);
    geometry(root.lastElementChild!);
    expect(textAnnotationTargetsAtPoint(root, [{ id: "a", startOffset: 0, endOffset: 5, annotation: target("a") }], 20, 25)).toEqual([target("a")]);
    expect(textAnnotationTargetsAtPoint(root, [], 20, 25)).toEqual([]);
    frame.remove();
  });

  it("does not confuse repeated passages or hit a rectangle's empty bounding region", () => {
    const root = document.createElement("div");
    root.innerHTML = '<mark data-highlight-id="a">same passage</mark><mark data-highlight-id="b">same passage</mark>';
    geometry(root.firstElementChild!, rect(10)); geometry(root.lastElementChild!, rect(200));
    const entries = [{ id: "a", annotation: target("a") }, { id: "b", annotation: target("b") }];
    expect(renderedAnnotationTargetsAtPoint(root, entries, 210, 25)).toEqual([target("b")]);
    expect(renderedAnnotationTargetsAtPoint(root, entries, 150, 25)).toEqual([]);
  });

  it.each([1, 2])("targets PDF page %s using rendered, transformed geometry and deduplicates fragments", (page) => {
    const annotation = target("saved:opaque:id");
    const highlights: StoredHighlight[] = [{ id: `renderer-${page}`, annotation, pageNumber: page, color: "yellow", text: annotation.text,
      createdAt: 0, pdfRects: [{ x1: 10, y1: 20, x2: 40, y2: 30 }, { x1: 10, y1: 35, x2: 40, y2: 45 }] }];
    const viewport = { convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [y2 * 2, x2 * 2, y1 * 2, x1 * 2] } as PageViewport;
    const { container } = render(<HighlightLayer viewport={viewport} pageIndex={page - 1} highlights={highlights} />);
    for (const element of container.querySelectorAll(".pdf-highlight")) geometry(element, rect(300, 400, 60, 20));
    expect(renderedAnnotationTargetsAtPoint(container, highlights, 320, 410)).toEqual([annotation]);
    expect(container.querySelector<HTMLElement>(".pdf-highlight")?.style.pointerEvents).toBe("none");
  });

  it("resolves overlapping canonical PDF reflow records by word IDs, not passage text", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-w="page1-word3" class="pdf-reflow-highlight">same passage</span>';
    geometry(root.firstElementChild!);
    const descriptors = [
      { id: "a:1", wordIds: ["page1-word3"], annotation: target("a") },
      { id: "b:1", wordIds: ["page1-word3"], annotation: target("b") },
      { id: "c:2", wordIds: ["page2-word3"], annotation: target("c") },
    ];
    expect(renderedAnnotationTargetsAtPoint(root, descriptors, 20, 25)).toEqual([target("a"), target("b")]);
  });

  it("deduplicates EPUB CFI fragments, excludes other chapters, and tolerates an unmounted range", () => {
    const other = document.implementation.createHTMLDocument();
    const range = document.createRange(); range.selectNodeContents(document.body);
    Object.defineProperty(range, "getClientRects", { value: () => [rect()] });
    const otherRange = other.createRange(); otherRange.selectNodeContents(other.body);
    const descriptors = ["a:0", "a:1", "other", "unmounted"].map((id) => ({ id, cfiRange: id, text: "same passage", annotation: target(id.startsWith("a:") ? "a" : id) }));
    const getRange = (cfi: string) => { if (cfi === "unmounted") throw new Error("unmounted"); return cfi === "other" ? otherRange : range; };
    expect(epubAnnotationTargetsAtPoint(descriptors, getRange, document, 20, 25)).toEqual([target("a")]);
  });

  it("Markdown right-click targets a saved mark without a selection and keeps plain-selection fallback", () => {
    const onContextMenu = vi.fn();
    const highlights = [{ id: "a", startOffset: 0, endOffset: 5, annotation: target("a") }];
    const { container } = render(<MarkdownViewer document={{ id: "doc" } as ReaderDocument} content="hello world" highlights={highlights} onContextMenu={onContextMenu} />);
    const mark = container.querySelector("mark")!; geometry(mark);
    fireEvent.contextMenu(mark, { clientX: 20, clientY: 25 });
    expect(onContextMenu).toHaveBeenLastCalledWith({ x: 20, y: 25, selectedText: "", annotations: [target("a")] });
    onContextMenu.mockClear();
    fireEvent.contextMenu(container.querySelector("p")!, { clientX: 200, clientY: 200 });
    expect(onContextMenu).not.toHaveBeenCalled();
    const range = document.createRange(); range.selectNodeContents(container.querySelector("p")!);
    window.getSelection()?.addRange(range);
    fireEvent.contextMenu(container.querySelector("p")!, { clientX: 200, clientY: 200 });
    expect(onContextMenu.mock.lastCall?.[0].selectedText).toBe("hello world");
  });
});
