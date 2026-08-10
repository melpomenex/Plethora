import { describe, expect, it } from "vitest";
import type { PdfSelectionContext } from "../../../types/selection";
import {
  initialPdfSelectionPersistenceState,
  reducePdfSelectionPersistence,
  type PdfSelectionPersistenceState,
  type SelectionClearReason,
} from "../pdfSelectionPersistence";

function createPdfContext(overrides: Partial<PdfSelectionContext> = {}): PdfSelectionContext {
  return {
    type: "pdf",
    documentId: "doc-1",
    pages: [
      {
        pageNumber: 1,
        viewportRects: [{ left: 0, top: 0, width: 100, height: 20 }],
        pdfRects: [{ x1: 0, y1: 0, x2: 100, y2: 20 }],
      },
    ],
    ...overrides,
  };
}

function committedState(): PdfSelectionPersistenceState {
  return reducePdfSelectionPersistence(initialPdfSelectionPersistenceState, {
    type: "commit",
    selection: createPdfContext(),
    text: "  selected passage  ",
    rect: new DOMRect(10, 20, 100, 20),
  });
}

describe("reducePdfSelectionPersistence — commit", () => {
  it("commits a valid PDF text selection and surfaces the popup", () => {
    const state = committedState();
    expect(state.selection?.documentId).toBe("doc-1");
    expect(state.selectedText).toBe("selected passage");
    expect(state.popupVisible).toBe(true);
    expect(state.popupRect).not.toBeNull();
  });

  it("hides the popup when no anchor rect is available but still commits the selection", () => {
    const state = reducePdfSelectionPersistence(initialPdfSelectionPersistenceState, {
      type: "commit",
      selection: createPdfContext(),
      text: "selected passage",
      rect: null,
    });
    expect(state.selection).not.toBeNull();
    expect(state.selectedText).toBe("selected passage");
    expect(state.popupVisible).toBe(false);
    expect(state.popupRect).toBeNull();
  });

  it("does NOT commit a collapsed selection (null context) — state stays empty", () => {
    const state = reducePdfSelectionPersistence(initialPdfSelectionPersistenceState, {
      type: "commit",
      selection: null,
      text: "anything",
      rect: null,
    });
    expect(state).toEqual(initialPdfSelectionPersistenceState);
  });

  it("does NOT commit a selection with empty trimmed text", () => {
    const state = reducePdfSelectionPersistence(initialPdfSelectionPersistenceState, {
      type: "commit",
      selection: createPdfContext(),
      text: "   \n  ",
      rect: null,
    });
    expect(state).toEqual(initialPdfSelectionPersistenceState);
  });

  it("does NOT commit a selection without resolvable page context (image-only / non-PDF)", () => {
    const noContext = createPdfContext({ pages: [] });
    const state = reducePdfSelectionPersistence(initialPdfSelectionPersistenceState, {
      type: "commit",
      selection: noContext,
      text: "some text",
      rect: null,
    });
    expect(state).toEqual(initialPdfSelectionPersistenceState);
  });

  it("replaces the previous committed selection on a new valid commit", () => {
    const first = committedState();
    const second = reducePdfSelectionPersistence(first, {
      type: "commit",
      selection: createPdfContext({ documentId: "doc-2" }),
      text: "newer passage",
      rect: new DOMRect(0, 0, 10, 10),
    });
    expect(second.selection?.documentId).toBe("doc-2");
    expect(second.selectedText).toBe("newer passage");
  });
});

describe("reducePdfSelectionPersistence — clear", () => {
  const reasons: SelectionClearReason[] = [
    "new-in-page-drag",
    "outside-page-click",
    "escape",
    "document-change",
    "action-complete",
  ];

  it.each(reasons)("clears overlay, popup, and text on the %s trigger", (reason) => {
    const cleared = reducePdfSelectionPersistence(committedState(), { type: "clear", reason });
    expect(cleared).toEqual(initialPdfSelectionPersistenceState);
  });

  it("clearing an already-empty state is a no-op", () => {
    const cleared = reducePdfSelectionPersistence(initialPdfSelectionPersistenceState, {
      type: "clear",
      reason: "escape",
    });
    expect(cleared).toEqual(initialPdfSelectionPersistenceState);
  });
});

describe("reducePdfSelectionPersistence — native-selection loss must NOT clear", () => {
  it("a dropped native selection (commit with null) leaves the committed overlay intact", () => {
    const afterLoss = reducePdfSelectionPersistence(committedState(), {
      type: "commit",
      selection: null,
      text: "",
      rect: null,
    });
    expect(afterLoss.selection).not.toBeNull();
    expect(afterLoss.selectedText).toBe("selected passage");
    expect(afterLoss.popupVisible).toBe(true);
  });
});

describe("reducePdfSelectionPersistence — hide-popup", () => {
  it("hides the popup but keeps the committed selection and text (scroll / re-layout)", () => {
    const hidden = reducePdfSelectionPersistence(committedState(), { type: "hide-popup" });
    expect(hidden.popupVisible).toBe(false);
    expect(hidden.popupRect).toBeNull();
    expect(hidden.selection).not.toBeNull();
    expect(hidden.selectedText).toBe("selected passage");
  });
});
