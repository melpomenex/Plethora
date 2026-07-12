import { describe, expect, it } from "vitest";
import { anchorFromReflowBlock, resolveReflowBlock } from "../pdfAnchorResolver";
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
});
