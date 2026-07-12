import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryPdfReflowCache } from "../pdfReflowCache";
import { PdfReflowRenderer, safePdfLink } from "../PdfReflowRenderer";
import {
  createPdfReflowDocument,
  parsePdfReflowDocument,
  pdfReflowCacheKey,
  serializePdfReflowDocument,
  type PdfReflowPage,
} from "../pdfReflowTypes";

const page: PdfReflowPage = {
  pageNumber: 1,
  width: 600,
  height: 800,
  state: "ready",
  classification: "semantic",
  confidence: 0.95,
  textCoverage: 0.5,
  warnings: [],
  blocks: [{
    id: "p1-b1",
    kind: "paragraph",
    text: "<script>alert('inert')</script>",
    source: { pageNumber: 1, rects: [{ x: 10, y: 20, width: 30, height: 10 }], tokenIds: ["t1"], confidence: 0.95 },
    extractionMethod: "pdf-text",
    confidence: 0.95,
    direction: "rtl",
    href: "javascript:alert(1)",
  }],
};

describe("PDF reflow model and cache", () => {
  it("round-trips only compatible versioned documents", async () => {
    let document = createPdfReflowDocument({ documentId: "doc", sourceIdentity: "source", fingerprint: "fp", pageCount: 2 });
    const cache = new MemoryPdfReflowCache();
    document = await cache.putPage(document, page);
    expect((await cache.get(pdfReflowCacheKey(document)))?.pages[1].blocks[0].text).toContain("script");
    expect(parsePdfReflowDocument(serializePdfReflowDocument(document))?.schemaVersion).toBe(1);
    expect(parsePdfReflowDocument(JSON.stringify({ ...document, schemaVersion: 99 }))).toBeNull();
  });
});

describe("safe PDF reflow rendering", () => {
  it("renders source text as inert RTL content with source semantics", () => {
    render(<PdfReflowRenderer pages={[page]} />);
    const text = screen.getByText("<script>alert('inert')</script>");
    expect(text.closest("p")).toHaveAttribute("dir", "rtl");
    expect(text.closest("a")).toBeNull();
    expect(screen.getByRole("article", { name: "Reflowed PDF" })).toBeInTheDocument();
  });

  it("permits only safe link protocols", () => {
    expect(safePdfLink("https://example.com")).toBe("https://example.com");
    expect(safePdfLink("mailto:reader@example.com")).toBe("mailto:reader@example.com");
    expect(safePdfLink("javascript:alert(1)")).toBeUndefined();
    expect(safePdfLink("data:text/html,bad")).toBeUndefined();
  });
});
