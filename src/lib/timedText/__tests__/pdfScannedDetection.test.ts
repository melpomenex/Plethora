import { describe, expect, it } from "vitest";
import { assessPdfPageTextUsability } from "../pdfScannedDetection";
import type { PdfCanonicalPage } from "../../../types/pdfCanonical";

function makePage(words: PdfCanonicalPage["words"]): PdfCanonicalPage {
  return {
    pageNumber: 1,
    width: 612,
    height: 792,
    rotation: 0,
    state: "ready",
    classification: "semantic",
    confidence: 0.9,
    textCoverage: 0.8,
    words,
    lines: [],
    blocks: [
      {
        id: "p1:b0",
        kind: "paragraph",
        role: "body",
        pageNumber: 1,
        sourceRegions: [],
        wordIds: words.map((w) => w.id),
        lineIds: [],
        readingOrder: 0,
        confidence: 0.9,
        text: words.map((w) => w.text).join(" "),
        direction: "ltr",
        language: "en",
        items: null,
        table: null,
        assetId: null,
        altText: null,
        captionOf: null,
        href: null,
        extraction: "native-pdf-text",
      },
    ],
    warnings: [],
    errorCategory: null,
    schemaVersion: 2,
    engineVersion: "rust-hybrid-v3",
  };
}

describe("assessPdfPageTextUsability", () => {
  it("returns word-level for native text pages", () => {
    const page = makePage([
      {
        id: "p1:w0",
        pageNumber: 1,
        text: "Hello",
        sourceBbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
        sourceFragments: [],
        bboxExact: true,
        readingOrder: 0,
        confidence: 0.95,
        source: "native-pdf-text",
        dehyphenated: false,
        font: null,
      },
    ]);
    expect(assessPdfPageTextUsability(page).usability).toBe("word-level");
  });

  it("returns unusable for graphical-only pages", () => {
    const page = makePage([
      {
        id: "p1:w0",
        pageNumber: 1,
        text: "",
        sourceBbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
        sourceFragments: [],
        bboxExact: false,
        readingOrder: 0,
        confidence: 0.1,
        source: "graphical",
        dehyphenated: false,
        font: null,
      },
    ]);
    const result = assessPdfPageTextUsability(page);
    expect(result.usability).toBe("unusable");
    expect(result.reason).toBe("scanned-or-graphical");
  });
});
