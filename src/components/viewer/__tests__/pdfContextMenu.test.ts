import { describe, expect, it } from "vitest";
import { resolvePdfContextMenu } from "../pdfContextMenu";
import type { PdfSelectionContext } from "../../../types/selection";

function pdfContext(documentId = "doc-1"): PdfSelectionContext {
  return {
    type: "pdf",
    documentId,
    source: "native",
    pages: [{ pageNumber: 3, viewportRects: [], pdfRects: [{ x1: 0, y1: 0, x2: 10, y2: 10 }] }],
  };
}

describe("resolvePdfContextMenu (desktop PDF right-click)", () => {
  it("emits the committed selection in fixed mode", () => {
    const payload = resolvePdfContextMenu({
      clientX: 120,
      clientY: 40,
      reflowSurfaceActive: false,
      committedSelection: pdfContext(),
      committedText: "committed passage",
      liveReflowSelection: null,
    });
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({ x: 120, y: 40, selectedText: "committed passage" });
    expect(payload!.selectionContext.type).toBe("pdf");
  });

  it("passes the default menu through when nothing is committed (fixed mode)", () => {
    expect(
      resolvePdfContextMenu({
        clientX: 10,
        clientY: 10,
        reflowSurfaceActive: false,
        committedSelection: null,
        committedText: "",
        liveReflowSelection: null,
      }),
    ).toBeNull();
  });

  it("ignores a committed context whose text is whitespace-only", () => {
    expect(
      resolvePdfContextMenu({
        clientX: 10,
        clientY: 10,
        reflowSurfaceActive: false,
        committedSelection: pdfContext(),
        committedText: "   ",
        liveReflowSelection: null,
      }),
    ).toBeNull();
  });

  it("emits the live reflow selection when the reflow surface is mounted", () => {
    const payload = resolvePdfContextMenu({
      clientX: 5,
      clientY: 6,
      reflowSurfaceActive: true,
      committedSelection: null,
      committedText: "",
      liveReflowSelection: { text: "reflowed passage", context: pdfContext("doc-2") },
    });
    expect(payload).toMatchObject({ x: 5, y: 6, selectedText: "reflowed passage" });
    expect(payload!.selectionContext.documentId).toBe("doc-2");
  });

  it("passes the default menu through when a live reflow selection does not resolve", () => {
    expect(
      resolvePdfContextMenu({
        clientX: 10,
        clientY: 10,
        reflowSurfaceActive: true,
        committedSelection: pdfContext(),
        committedText: "committed passage",
        liveReflowSelection: null,
      }),
    ).toBeNull();
  });

  it("falls back to the committed selection when the mode says reflow but the fixed surface is rendered", () => {
    // No reflow document yet: the container renders fixed page views, so the
    // committed selection — not the (absent) reflow DOM — is the menu source.
    const payload = resolvePdfContextMenu({
      clientX: 1,
      clientY: 2,
      reflowSurfaceActive: false,
      committedSelection: pdfContext(),
      committedText: "committed passage",
      liveReflowSelection: null,
    });
    expect(payload).toMatchObject({ selectedText: "committed passage" });
  });
});
