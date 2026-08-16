import { describe, expect, it } from "vitest";
import { anchorFromCanonicalBlock, anchorFromReflowBlock, resolveReflowBlock } from "../pdfAnchorResolver";
import { computeCropSourceRect } from "../../../lib/pdf/cropGeometry";
import type { PdfCanonicalBlock } from "../../../types/pdfCanonical";
import { createPdfReflowDocument, type PdfReflowBlock } from "../pdfReflowTypes";

const block: PdfReflowBlock = {
  id: "p2-b3",
  kind: "paragraph",
  text: "A trustworthy passage from the source PDF.",
  source: { pageNumber: 2, rects: [{ x: 10, y: 20, width: 100, height: 30 }], tokenIds: ["t1"], confidence: 0.94 },
  extractionMethod: "pdf-text",
  confidence: 0.94,
  direction: "ltr",
};

describe("shared PDF source anchors", () => {
  it("round-trips exact block anchors and falls back through quotes and geometry", () => {
    const document = createPdfReflowDocument({ documentId: "doc", sourceIdentity: "s", fingerprint: "fp", pageCount: 2 });
    document.pages[2] = { pageNumber: 2, width: 600, height: 800, state: "ready", classification: "semantic", confidence: 0.9, textCoverage: 0.3, warnings: [], blocks: [block] };
    const anchor = anchorFromReflowBlock(block, "fp", 4);
    expect(resolveReflowBlock(document, anchor)?.id).toBe(block.id);
    expect(resolveReflowBlock(document, { pageNumber: 2, textQuote: "trustworthy passage" })?.id).toBe(block.id);
    expect(resolveReflowBlock(document, { pageNumber: 2, rect: { x: 20, y: 25, width: 20, height: 10 } })?.id).toBe(block.id);
  });

  it("anchors a canonical figure block on its source_regions[0] union bbox", () => {
    // "View Original" navigation and the crop pipeline both key off the
    // figure's FIRST source region — the complete union bbox since the
    // geometry overhaul — not a fragment of it.
    const figure: PdfCanonicalBlock = {
      id: "p1:fig0",
      kind: "figure",
      role: "body",
      pageNumber: 1,
      sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 300, x1: 500, y1: 600 } }],
      wordIds: [],
      lineIds: [],
      readingOrder: 0,
      confidence: 0.5,
      text: "",
      direction: "auto",
      language: null,
      items: null,
      table: null,
      assetId: null,
      sourceWidth: null,
      sourceHeight: null,
      altText: "Figure 1 Architecture",
      captionOf: null,
      href: null,
      extraction: "graphical",
    };
    const anchor = anchorFromCanonicalBlock(figure, "fp");
    expect(anchor.rect).toEqual({ x: 100, y: 300, width: 400, height: 300 });
    // The math path a rotated page takes (crop/"View Original" device box):
    // the union bbox maps onto the swapped-dims render with the box's axes
    // swapped and its top-left at the device point of the model corner.
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      figure.sourceRegions[0].bbox,
      612,
      792,
      90,
      792,
      612,
      0,
    );
    expect([srcX, srcY, srcW, srcH]).toEqual([300, 100, 300, 400]);
  });
});
