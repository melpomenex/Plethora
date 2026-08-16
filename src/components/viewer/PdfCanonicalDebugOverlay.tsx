/**
 * Layout debug overlay (task 8.5): renders detected blocks, reading-order
 * numbers, kinds, roles, and confidence over a page. Enabled per document
 * via localStorage `incrementum.pdf.reflow.debug` — developer tooling, kept
 * out of the normal UI.
 */
import type { PdfCanonicalPage } from "../../types/pdfCanonical";
import { computeCropSourceRect } from "../../lib/pdf/cropGeometry";

export const PDF_REFLOW_DEBUG_KEY = "incrementum.pdf.reflow.debug";

export function isPdfReflowDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PDF_REFLOW_DEBUG_KEY) === "true";
}

const KIND_LABEL_COLOR: Record<string, string> = {
  heading: "#7c3aed",
  paragraph: "#2563eb",
  list: "#0891b2",
  figure: "#d97706",
  caption: "#059669",
  equation: "#dc2626",
  table: "#16a34a",
  footnote: "#9333ea",
  code: "#0284c7",
  "horizontal-rule": "#64748b",
  "page-break": "#94a3b8",
  "unknown-visual": "#475569",
};

export function PdfCanonicalDebugOverlay({
  page,
  rotation = 0,
  viewportWidth,
  viewportHeight,
}: {
  page: PdfCanonicalPage;
  /** Viewer rotation the page is rendered with (0/90/180/270). */
  rotation?: number;
  /** CSS pixel size of the rendered page the overlay sits on (rotated). */
  viewportWidth: number;
  viewportHeight: number;
}) {
  // Model rects live in unrotated PDF user space; the render applies the
  // viewer rotation. computeCropSourceRect (pad 0) is the same transform the
  // crop pipeline and the diag harness use, so boxes track the render at any
  // rotation instead of only rotation 0.
  const toCss = (bbox: { x0: number; y0: number; x1: number; y1: number }) => {
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      bbox,
      page.width,
      page.height,
      rotation,
      viewportWidth,
      viewportHeight,
      0,
    );
    return { left: srcX, top: srcY, width: srcW, height: srcH };
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {/* Page-level diagnostics pill */}
      <div className="absolute top-2 right-2 bg-black/80 text-white text-[10px] font-mono px-2 py-1 rounded shadow pointer-events-auto select-text">
        {`p${page.pageNumber} [${page.classification}] cov:${(page.textCoverage * 100).toFixed(0)}% blocks:${page.blocks.length}`}
      </div>
      {page.blocks.map((block) => {
        const region = block.sourceRegions[0];
        if (!region) return null;
        const style = toCss(region.bbox);
        const color = KIND_LABEL_COLOR[block.kind] ?? "#6b7280";
        const captionInfo = block.captionOf ? ` ↳ ${block.captionOf}` : "";
        return (
          <div
            key={block.id}
            className="absolute border-2"
            style={{ ...style, borderColor: color, mixBlendMode: "multiply" }}
          >
            <span
              className="absolute -top-0.5 left-0 px-1 text-[9px] leading-tight text-white whitespace-nowrap shadow-sm rounded-br"
              style={{ backgroundColor: color }}
            >
              {`#${block.readingOrder} ${block.kind}${block.role !== "body" ? `/${block.role}` : ""}${captionInfo} c${block.confidence.toFixed(2)}`}
            </span>
          </div>
        );
      })}
      {/* Word-level boxes, faint, for selection-mapping diagnosis. */}
      {page.words.map((word) => (
        <div
          key={word.id}
          className="absolute border border-dashed"
          style={{
            ...toCss(word.sourceBbox),
            borderColor: "rgba(37, 99, 235, 0.35)",
          }}
        />
      ))}
    </div>
  );
}
