import type { PdfSelectionContext } from "../../types/selection";
import { hasUsablePdfSelectionContext } from "./pdfTextSelection";

/**
 * Committed-selection persistence state machine.
 *
 * The PDF viewer's visual selection persistence is centralized here as a pure
 * reducer (same pattern as `pdfReaderState.ts`), so the commit/clear semantics
 * from the `pdf-selection-persistence` spec are unit-testable:
 *
 * - COMMIT only on a valid PDF text selection (non-collapsed, anchored in a
 *   rendered text layer, non-empty trimmed text, resolvable per-page context).
 *   A commit with no selection / empty text is a NO-OP — it must not clear an
 *   existing persisted selection, because a dropped native selection is no
 *   longer a clear signal (WKWebView drops the document selection whenever
 *   focus moves to the popup / assistant panel / another control).
 * - CLEAR only on an explicit user or system event (new in-page drag, click
 *   outside any page, Escape, document change, action completion, OCR region
 *   selection). The overlay persists across idle time and unrelated re-renders.
 */

export type SelectionClearReason =
  | "new-in-page-drag"
  | "outside-page-click"
  | "escape"
  | "document-change"
  | "action-complete";

export interface PdfSelectionPersistenceState {
  /** The committed PDF selection — the source of truth for the overlay. */
  selection: PdfSelectionContext | null;
  /** Trimmed text of the committed selection (surfaces popup + downstream actions). */
  selectedText: string;
  /** Floating popup visibility + anchor rect. */
  popupVisible: boolean;
  popupRect: DOMRect | null;
}

export const initialPdfSelectionPersistenceState: PdfSelectionPersistenceState = {
  selection: null,
  selectedText: "",
  popupVisible: false,
  popupRect: null,
};

export type PdfSelectionPersistenceAction =
  | {
      type: "commit";
      selection: PdfSelectionContext | null;
      text: string;
      rect: DOMRect | null;
    }
  | { type: "clear"; reason: SelectionClearReason }
  | { type: "hide-popup" };

export function reducePdfSelectionPersistence(
  state: PdfSelectionPersistenceState,
  action: PdfSelectionPersistenceAction,
): PdfSelectionPersistenceState {
  switch (action.type) {
    case "commit": {
      // Only valid PDF text selections are committed; everything else is
      // ignored and leaves the persisted state untouched.
      const text = action.text.trim();
      if (!action.selection || !text || !hasUsablePdfSelectionContext(action.selection)) {
        return state;
      }
      return {
        selection: action.selection,
        selectedText: text,
        popupVisible: action.rect !== null,
        popupRect: action.rect,
      };
    }
    case "hide-popup":
      // Scroll / re-layout hides the floating popup but must NOT clear the
      // persisted overlay or committed text.
      return { ...state, popupVisible: false, popupRect: null };
    case "clear":
      return { ...initialPdfSelectionPersistenceState };
    default:
      return state;
  }
}
