/**
 * Canonical selection facade tests (task 3.2/3.4): enrichment attaches the
 * v2 anchor with exact text, single-page only, and never fails a selection
 * on resolver errors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrichPdfSelectionWithCanonical, clearCanonicalSelectionCaches } from "../canonicalSelection";
import type { PdfSelectionContext } from "../../../types/selection";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invokeCommand: mocks.invokeCommand,
}));

function selectionContext(): PdfSelectionContext {
  return {
    type: "pdf",
    documentId: "doc-1",
    fingerprint: "fp",
    source: "native",
    pages: [
      {
        pageNumber: 3,
        viewportRects: [{ left: 10, top: 20, width: 30, height: 10 }],
        pdfRects: [{ x1: 100, y1: 700, x2: 200, y2: 710 }],
      },
    ],
  };
}

describe("enrichPdfSelectionWithCanonical", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    clearCanonicalSelectionCaches();
    // First call resolves the document source info, second performs the
    // selection resolution.
    mocks.invokeCommand.mockImplementation(async (command: string) => {
      if (command === "get_pdf_document_source_info") {
        return { documentId: "doc-1", size: 1, identity: "identity-1", fingerprint: "fp", maxChunkSize: 512 };
      }
      if (command === "pdf_reflow_resolve_selection") {
        return {
          startWordId: "p3:w2",
          endWordId: "p3:w4",
          wordIds: ["p3:w2", "p3:w3", "p3:w4"],
          text: "brown fox jumps",
          pageRegions: [
            { pageNumber: 3, bbox: { x0: 154, y0: 700, x1: 246, y1: 710 } },
          ],
        };
      }
      return null;
    });
  });

  it("attaches the v2 anchor with exact canonical text", async () => {
    const enriched = await enrichPdfSelectionWithCanonical(selectionContext());
    expect(enriched.canonical).toEqual({
      version: 2,
      startWordId: "p3:w2",
      endWordId: "p3:w4",
      wordIds: ["p3:w2", "p3:w3", "p3:w4"],
      blockIds: [],
      pageRegions: [{ pageNumber: 3, bbox: { x0: 154, y0: 700, x1: 246, y1: 710 } }],
      text: "brown fox jumps",
    });
  });

  it("converts legacy rects to tuples with the cache context", async () => {
    await enrichPdfSelectionWithCanonical(selectionContext());
    const resolveCall = mocks.invokeCommand.mock.calls.find(
      ([command]) => command === "pdf_reflow_resolve_selection",
    );
    expect(resolveCall?.[1]).toMatchObject({
      documentId: "doc-1",
      sourceIdentity: "identity-1",
      schemaVersion: 2,
      engineVersion: "rust-hybrid-v3",
      pageNumber: 3,
      rects: [[100, 700, 200, 710]],
    });
  });

  it("misses leave the context untouched", async () => {
    mocks.invokeCommand.mockImplementation(async (command: string) => {
      if (command === "get_pdf_document_source_info") {
        return { documentId: "doc-1", size: 1, identity: "identity-1", fingerprint: "fp", maxChunkSize: 512 };
      }
      return null; // unanalyzed page
    });
    const context = selectionContext();
    const enriched = await enrichPdfSelectionWithCanonical(context);
    expect(enriched).toBe(context);
  });

  it("resolver failures never break the selection", async () => {
    mocks.invokeCommand.mockRejectedValue(new Error("ipc down"));
    const context = selectionContext();
    const enriched = await enrichPdfSelectionWithCanonical(context);
    expect(enriched.canonical).toBeUndefined();
  });

  it("multi-page selections are left for the full reflow wiring", async () => {
    const context = selectionContext();
    context.pages.push({
      pageNumber: 4,
      viewportRects: [{ left: 0, top: 0, width: 10, height: 10 }],
      pdfRects: [{ x1: 0, y1: 0, x2: 10, y2: 10 }],
    });
    const enriched = await enrichPdfSelectionWithCanonical(context);
    expect(enriched.canonical).toBeUndefined();
    expect(mocks.invokeCommand).toHaveBeenCalledTimes(0);
  });
});
