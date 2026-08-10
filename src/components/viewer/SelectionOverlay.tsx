import React, { useMemo } from "react";
import type { PageViewport } from "pdfjs-dist";
import type { PdfRect } from "../../types/selection";
import { pdfRectToViewportRect } from "./HighlightLayer";

export interface SelectionOverlayProps {
  /** Page index (0-indexed) — only used for stable React keys. */
  pageIndex: number;
  /** Current page viewport. Overlay rects are derived from `pdfRects` at
   *  every render through THIS viewport, never from cached CSS pixels, so
   *  re-derivation at any scale is exact. */
  viewport: PageViewport | null;
  /** PDF-space rects of the persisted selection on this page. */
  pdfRects: PdfRect[];
}

/**
 * Persisted-selection overlay.
 *
 * Paints the committed PDF selection as absolutely-positioned highlight rects
 * inside the per-page `pdf-highlight-overlay` stack (above the PDF.js text
 * layer, `pointer-events: none`, so text selection still works). Because rects
 * are re-derived from PDF-space rects through the current viewport at every
 * render, the overlay tracks the passage exactly across zoom / relayout, and is
 * simply not painted when the page is not currently rendered (viewport null) —
 * the committed state lives in the viewer, so scrolling back re-paints it.
 */
export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  pageIndex,
  viewport,
  pdfRects,
}) => {
  const rects = useMemo(() => {
    if (!viewport || pdfRects.length === 0) return [];
    return pdfRects
      .map((pdfRect) => pdfRectToViewportRect(pdfRect, viewport))
      .filter((rect): rect is NonNullable<typeof rect> => rect !== null)
      .filter((rect) => rect.width > 0 && rect.height > 0);
  }, [viewport, pdfRects]);

  if (rects.length === 0) {
    return null;
  }

  return (
    <div className="pdf-selection-overlay" aria-hidden="true">
      {rects.map((rect, index) => (
        <div
          key={`${pageIndex}-${index}`}
          className="pdf-selection-rect"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
  );
};

export default SelectionOverlay;
