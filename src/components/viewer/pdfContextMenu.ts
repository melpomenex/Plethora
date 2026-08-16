import type { PdfSelectionContext } from "../../types/selection";

/** Payload PDFViewer emits on a valid right-click. Mirrors EPUBViewer's
 *  onContextMenu contract; coords are top-document client coords because PDF
 *  surfaces (text layers and the reflow DOM) are not iframed. */
export interface PdfContextMenuPayload {
  x: number;
  y: number;
  selectedText: string;
  selectionContext: PdfSelectionContext;
}

export interface PdfContextMenuInput {
  clientX: number;
  clientY: number;
  /** True when the reflow DOM is actually mounted in the scroll container
   *  (mode can say "reflow" while the container still renders fixed page
   *  views because no reflow document exists yet). */
  reflowSurfaceActive: boolean;
  /** Fixed mode: the last committed selection context (persisted overlay
   *  source of truth), or null when nothing is committed. */
  committedSelection: PdfSelectionContext | null;
  /** Fixed mode: the committed selection's text. */
  committedText: string;
  /** Reflow mode: the live native selection resolved against the reflow DOM
   *  (canonical v2 or v1 block lookup), or null when it does not resolve. */
  liveReflowSelection: { text: string; context: PdfSelectionContext } | null;
}

/**
 * Decide whether a right-click inside the PDF reading surface opens the shared
 * text-selection context menu, and with what payload. Null means "no valid
 * selection — let the platform's default menu through" (no preventDefault).
 *
 * Fixed mode reports the COMMITTED selection (provenance already validated by
 * the mouseup commit path); reflow mode derives fresh from the live selection
 * because reflow selections are never persisted in the viewer.
 */
export function resolvePdfContextMenu(input: PdfContextMenuInput): PdfContextMenuPayload | null {
  if (input.reflowSurfaceActive) {
    if (!input.liveReflowSelection) return null;
    return {
      x: input.clientX,
      y: input.clientY,
      selectedText: input.liveReflowSelection.text,
      selectionContext: input.liveReflowSelection.context,
    };
  }
  const committedText = input.committedText.trim();
  if (!input.committedSelection || !committedText) return null;
  return {
    x: input.clientX,
    y: input.clientY,
    selectedText: committedText,
    selectionContext: input.committedSelection,
  };
}
