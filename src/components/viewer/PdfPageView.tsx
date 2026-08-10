import { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
// PDFPageView and EventBus are exported from pdf.js's viewer module. PDFPageView
// owns the per-page DOM (a `.page` div containing canvasWrapper + textLayer +
// annotationLayer), sets the `--scale-factor` / `--user-unit` CSS variables
// itself, and manages the canvas + text-layer render lifecycle. Using it removes
// the hand-rolled DOM/cancel/`parentNode-is-null` defensive code that broke
// text selection on WKWebView and on every pdf.js upgrade.
import { PDFPageView, EventBus } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PageViewport } from "pdfjs-dist";
import { HighlightLayer, type StoredHighlight } from "./HighlightLayer";
import { SelectionOverlay } from "./SelectionOverlay";
import type { PdfRect } from "../../types/selection";
import { hasSelectableTextInLayer } from "./pdfTextSelection";
import { cn } from "../../utils";

// PDF.js internally multiplies the page scale by PDF_TO_CSS_UNITS (96/72 ≈
// 1.333) when computing the viewport, so that 1 PDF point ≈ 1.333 CSS pixels
// (the standard 72→96 DPI conversion). This app's `scale` prop is a direct
// user-facing zoom factor where 1.0 = "100%" rendered at PDF-point pixel size
// (612pt page → 612px), matching the previous hand-rolled renderer. To preserve
// that visual sizing, divide the incoming scale by PDF_TO_CSS_UNITS before
// handing it to PDFPageView, which then re-multiplies — netting back to the
// raw scale the app has always used.
const PDF_TO_CSS_UNITS = 96 / 72;

// One process-wide type alias so we don't fight pdf.js's any-typed exports.
type PdfPageViewInstance = InstanceType<typeof PDFPageView>;

// Stable empty array so `selectionPdfRects ?? EMPTY` keeps a constant reference
// (a fresh `[]` per render would defeat SelectionOverlay's useMemo on pdfRects).
const EMPTY_PDF_RECTS: PdfRect[] = [];

export interface PdfPageViewWrapperProps {
  /** The loaded pdf.js document. The wrapper fetches its page on mount. */
  pdf: pdfjsLib.PDFDocumentProxy;
  /** 0-indexed page index (page number is `pageIndex + 1`). */
  pageIndex: number;
  /** Resolved display scale (already incorporates fit-width/fit-page). */
  scale: number;
  /** Shared event bus — every page view in a document must share one. */
  eventBus: EventBus;
  /** Saved highlights to render over the page. */
  highlights: StoredHighlight[];
  /** PDF-space rects of a persisted selection on this page (null = none). */
  selectionPdfRects?: PdfRect[] | null;
  /** Whether OCR region selection is active (disables text-layer pointer events). */
  ocrActive: boolean;
  /** Called once the text layer has rendered, with the `.textLayer` root div. */
  onTextLayerReady: (pageIndex: number, textLayerDiv: HTMLDivElement | null) => void;
  /** Called with the page viewport whenever it changes (zoom, initial render). */
  onViewportChange: (pageIndex: number, viewport: PageViewport) => void;
  /** Called with the outer slot element whenever it mounts (null on unmount). */
  onSlotRef: (pageIndex: number, slot: HTMLDivElement | null) => void;
  /** Called with the rendered canvas element whenever it changes. */
  onCanvasRef: (pageIndex: number, canvas: HTMLCanvasElement | null) => void;
  /** Called with whether the page has a selectable text layer. */
  onTextSelectionAvailability: (pageNumber: number, hasSelectableText: boolean) => void;
  /** Optional className for the slot. */
  className?: string;
  /** Optional inline style for the slot (e.g. min size before first render). */
  style?: React.CSSProperties;
  /** Optional children rendered in an OCR overlay layer above the page. */
  children?: React.ReactNode;
}

/**
 * Imperatively hosts a pdf.js `PDFPageView` inside a React-managed slot.
 *
 * React owns the outer slot `<div>` (so virtualization/scroll math still have a
 * stable element to measure). pdf.js owns the inner `.page` div that it creates
 * in its constructor and appends to the slot. The `HighlightLayer` is rendered
 * as a sibling above the `.page` div with `pointer-events: none` so text
 * selection passes through; individual highlight rects re-enable pointer events
 * on hover.
 *
 * The lifecycle: create → `setPdfPage` → `draw()` on mount; `reset()` + `draw()`
 * on scale change; `destroy()` + remove the `.page` div on unmount.
 */
export function PdfPageViewWrapper({
  pdf,
  pageIndex,
  scale,
  eventBus,
  highlights,
  selectionPdfRects,
  ocrActive,
  onTextLayerReady,
  onViewportChange,
  onSlotRef,
  onCanvasRef,
  onTextSelectionAvailability,
  className,
  style,
  children,
}: PdfPageViewWrapperProps) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const pageViewRef = useRef<PdfPageViewInstance | null>(null);
  // Compensate for PDF.js's internal PDF_TO_CSS_UNITS multiplication so the
  // app's `scale` (1.0 = 100% at PDF-point pixel size) renders the same as the
  // previous hand-rolled renderer. See the PDF_TO_CSS_UNITS comment above.
  const pdfScale = scale / PDF_TO_CSS_UNITS;

  const pageNumber = pageIndex + 1;

  // Create the PDFPageView once when the slot mounts.
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    let cancelled = false;

    const init = async () => {
      const pdfPage = await pdf.getPage(pageNumber);
      if (cancelled) return;

      // Compute the default viewport at the initial scale. Pass pdfScale (already
      // compensated for PDF_TO_CSS_UNITS) so PDFPageView's internal re-multiply
      // nets back to the app's raw scale.
      const defaultViewport = pdfPage.getViewport({ scale: pdfScale });

      const pageView = new PDFPageView({
        container: slot,
        eventBus,
        id: pageNumber,
        scale: pdfScale,
        defaultViewport,
        // Text layer on (default). Annotation layer off — we don't render link
        // annotations and it adds overhead + DOM we'd have to style around.
        textLayerMode: 1, // TextLayerMode.ENABLE = 1
      });
      if (cancelled) {
        try { pageView.destroy(); } catch { /* ignore */ }
        try { pageView.div.remove(); } catch { /* ignore */ }
        return;
      }
      pageViewRef.current = pageView;

      // `setPdfPage` recomputes the viewport (scale * PDF_TO_CSS_UNITS) and resets.
      pageView.setPdfPage(pdfPage);
      onViewportChange(pageIndex, pageView.viewport);

      try {
        await pageView.draw();
      } catch (err: any) {
        if (cancelled) return;
        if (err?.name === "RenderingCancelledException") return;
        console.warn(`[PdfPageView] page ${pageNumber} draw failed:`, err?.message || err);
        return;
      }
      if (cancelled) return;
      // Surface the canvas (lives inside .canvasWrapper after draw).
      onCanvasRef(pageIndex, pageView.canvas ?? null);
      // Surface the text layer root if it rendered.
      const textLayerDiv = pageView.textLayer?.div ?? null;
      onTextLayerReady(pageIndex, textLayerDiv);
      onTextSelectionAvailability(pageNumber, textLayerDiv ? hasSelectableTextInLayer(textLayerDiv) : false);
    };

    void init();

    // Also listen for re-renders (e.g. text layer finishing after canvas) so we
    // surface the text layer even if draw() resolves before it's appended.
    const onTextLayerRendered = (evt: any) => {
      if (evt.pageNumber !== pageNumber || cancelled) return;
      const pageView = pageViewRef.current;
      if (!pageView) return;
      const div = pageView.textLayer?.div ?? null;
      onTextLayerReady(pageIndex, div);
      if (div) onTextSelectionAvailability(pageNumber, hasSelectableTextInLayer(div));
    };
    const onPageRendered = (evt: any) => {
      if (evt.pageNumber !== pageNumber || cancelled) return;
      const pageView = pageViewRef.current;
      if (!pageView) return;
      onCanvasRef(pageIndex, pageView.canvas ?? null);
      onViewportChange(pageIndex, pageView.viewport);
    };
    // pdf.js EventBus uses `_on`/`_off` for internal listeners (the public
    // `on` is aliased). `_on` is stable across v5.
    (eventBus as any)._on("textlayerrendered", onTextLayerRendered);
    (eventBus as any)._on("pagerendered", onPageRendered);

    return () => {
      cancelled = true;
      (eventBus as any)._off("textlayerrendered", onTextLayerRendered);
      (eventBus as any)._off("pagerendered", onPageRendered);
      const pageView = pageViewRef.current;
      if (pageView) {
        try {
          pageView.destroy();
        } catch {
          // ignore — destroy can throw if internal state was already torn down
        }
        // destroy() does not remove the .page div from the slot; do it explicitly.
        try {
          pageView.div.remove();
        } catch {
          /* ignore */
        }
        pageViewRef.current = null;
      }
      onTextLayerReady(pageIndex, null);
      onCanvasRef(pageIndex, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNumber]); // recreate when the document or page number changes

  // Re-render on scale change (zoom / fit-width / fit-page recalculation).
  // PDFPageView.update({ scale }) sets this.scale, recomputes the viewport, and
  // triggers a reset+draw internally (standalone mode). We just surface the
  // resulting canvas/viewport/text layer back to the parent after it settles.
  useEffect(() => {
    const pageView = pageViewRef.current;
    if (!pageView) return;
    // pageView.scale holds the compensated value; compare against pdfScale.
    if (Math.abs(pdfScale - pageView.scale) < 1e-6) return;
    let cancelled = false;
    (async () => {
      try {
        // update() dispatches pagerendered when done; the event listener above
        // surfaces canvas/viewport. Wait a microtask for it to flush.
        pageView.update({ scale: pdfScale });
        await new Promise<void>((r) => setTimeout(r, 0));
      } catch (err: any) {
        if (cancelled) return;
        if (err?.name === "RenderingCancelledException") return;
        console.warn(`[PdfPageView] page ${pageNumber} redraw failed:`, err?.message || err);
        return;
      }
      if (cancelled) return;
      onViewportChange(pageIndex, pageView.viewport);
      onCanvasRef(pageIndex, pageView.canvas ?? null);
      const div = pageView.textLayer?.div ?? null;
      onTextLayerReady(pageIndex, div);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfScale]);

  return (
    <div
      ref={(el) => {
        slotRef.current = el;
        onSlotRef(pageIndex, el);
      }}
      data-pdf-page
      data-page-number={pageNumber}
      className={cn("relative shadow-lg border border-border bg-white pdfViewer", className)}
      style={{
        contain: "layout style paint",
        ...style,
      }}
    >
      {/* HighlightLayer overlays the PDFPageView's .page div. pointer-events
          none lets text selection pass through to the text layer below; the
          HighlightLayer component re-enables pointer events on individual
          highlight rects when interactive. */}
      <div
        className="pdf-highlight-overlay"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 3,
        }}
      >
        <HighlightLayer
          pageIndex={pageIndex}
          viewport={pageViewRef.current?.viewport ?? null}
          highlights={highlights}
          interactive={true}
          onHighlightClick={(highlight) => {
            console.log("Highlight clicked:", highlight);
            // TODO: Show highlight options menu
          }}
        />
        {/* Persisted-selection overlay: re-derives its rects from the selection's
            PDF-space rects through the current viewport on every render, so it
            tracks the passage across zoom / relayout. Painted only while this
            page is rendered; committed state lives in the viewer. */}
        <SelectionOverlay
          pageIndex={pageIndex}
          viewport={pageViewRef.current?.viewport ?? null}
          pdfRects={selectionPdfRects ?? EMPTY_PDF_RECTS}
        />
      </div>
      {/* OCR overlays (region selector / progress / preview) render above
          everything when OCR is active on this page. Passed in as children by
          the parent, which knows the OCR flow state. */}
      {ocrActive && children ? (
        <div
          className="pdf-ocr-overlay"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "auto",
            zIndex: 4,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
