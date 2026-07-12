import { describe, expect, it, vi } from "vitest";
import { analyzePdfTextItems, removeRepeatedPageMargins } from "../pdfReflowAnalyzer";
import { PdfReflowScheduler, pdfPagePriorityOrder } from "../pdfReflowScheduler";
import { createPdfReflowDocument } from "../pdfReflowTypes";
import { MemoryPdfReflowCache } from "../pdfReflowCache";

function item(str: string, x: number, y: number, size = 12, width = str.length * 6, dir = "ltr") {
  return { str, transform: [size, 0, 0, size, x, y] as [number, number, number, number, number, number], width, height: size, dir, hasEOL: true };
}

describe("PDF geometry reflow analyzer", () => {
  it("orders two columns and retains token geometry", () => {
    const page = analyzePdfTextItems({
      pageNumber: 1,
      width: 600,
      height: 800,
      items: [
        item("TITLE", 50, 760, 20, 500),
        item("Left one is a paragraph with enough text", 50, 700),
        item("Right one is a paragraph with enough text", 340, 700),
        item("Left two continues the article content", 50, 670),
        item("Right two continues the article content", 340, 670),
        item("Left three completes this column content", 50, 640),
        item("Right three completes this column content", 340, 640),
      ],
    });
    expect(page.classification).toMatch(/semantic/);
    expect(page.blocks[0]).toMatchObject({ kind: "heading", text: "TITLE" });
    const text = page.blocks.map((block) => block.text).join("|");
    expect(text.indexOf("Left three")).toBeLessThan(text.indexOf("Right one"));
    expect(page.blocks[1].source.tokenIds[0]).toBe("p1-t1");
    expect(page.blocks[1].source.rects[0]).toMatchObject({ x: 50, y: 700 });
  });

  it("classifies text-poor scans for OCR and preserves RTL direction", () => {
    const scan = analyzePdfTextItems({ pageNumber: 1, width: 600, height: 800, items: [] });
    expect(scan).toMatchObject({ state: "ocr-required", classification: "ocr-required" });

    const rtl = analyzePdfTextItems({
      pageNumber: 2,
      width: 600,
      height: 800,
      items: [item("مرحبا بكم في هذا النص الطويل القابل للقراءة", 100, 700, 14, 300, "rtl")],
    });
    expect(rtl.blocks[0].direction).toBe("rtl");
  });

  it("detects lists, tables, captions, equations, and repeated margins", () => {
    const makePage = (pageNumber: number) => analyzePdfTextItems({
      pageNumber,
      width: 600,
      height: 800,
      items: [
        item(`Journal ${pageNumber}`, 50, 790),
        item("- first list item with useful content", 50, 700),
        item("Name", 50, 650), item("Value", 250, 650),
        item("Figure 1. Results overview", 50, 600),
        item("x = y + ∑ z", 50, 550),
      ],
    });
    const pages = removeRepeatedPageMargins([makePage(1), makePage(2), makePage(3)]);
    expect(pages[0].blocks.some((block) => block.text.startsWith("Journal"))).toBe(false);
    const kinds = new Set(pages[0].blocks.map((block) => block.kind));
    expect(kinds.has("list")).toBe(true);
    expect(kinds.has("table")).toBe(true);
    expect(kinds.has("caption") || kinds.has("equation")).toBe(true);
  });
});

describe("incremental page priority", () => {
  it("processes the current page, then adjacent pages, then outward", () => {
    expect(pdfPagePriorityOrder(6, 3)).toEqual([3, 4, 2, 5, 1, 6]);
  });

  it("reuses completed cached pages instead of analyzing them again", async () => {
    const document = createPdfReflowDocument({ documentId: "doc", sourceIdentity: "s", fingerprint: "f", pageCount: 1 });
    document.pages[1] = analyzePdfTextItems({ pageNumber: 1, width: 600, height: 800, items: [item("Cached readable text long enough for semantics", 50, 700)] });
    const pdf = { numPages: 1, getPage: vi.fn() } as any;
    const scheduler = new PdfReflowScheduler(pdf, document, new MemoryPdfReflowCache(), vi.fn());
    await scheduler.start(1);
    expect(pdf.getPage).not.toHaveBeenCalled();
    scheduler.cancel();
  });
});
