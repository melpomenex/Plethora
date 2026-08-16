/**
 * Frontend analysis-input collector (design D1): renders one page at
 * analysis resolution through the existing pdf.js pipeline and gathers its
 * text items, then hands both to the Rust analyzer
 * (`pdf_reflow_analyze_page`).
 *
 * The raster is best-effort: without a working canvas (jsdom, exotic
 * environments) the collector still returns text items and the engine
 * analyzes text-only with a `no-raster` warning.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfFontInfo } from "../../types/pdfCanonical";

/** ~120 dpi — enough for segmentation, bounded for IPC size. */
const ANALYSIS_SCALE = 120 / 72;
/** Hard cap on the raster's longest edge in pixels. */
const MAX_RASTER_EDGE_PX = 1700;

export interface CollectedTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  dir: string;
  font: PdfFontInfo | null;
  hasEol: boolean;
}

export interface CollectedPageInput {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  rasterPngBase64: string | null;
  rasterScale: number;
  textItems: CollectedTextItem[];
}

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  dir: string;
  fontName?: string;
  hasEOL: boolean;
}

interface PdfJsStyle {
  fontFamily?: string;
}

export function analysisScaleFor(pageWidth: number, pageHeight: number): number {
  const longestEdge = Math.max(pageWidth, pageHeight);
  return Math.min(ANALYSIS_SCALE, MAX_RASTER_EDGE_PX / Math.max(longestEdge, 1));
}

/** Resolve pdf.js styles-map font metadata into the canonical font info. */
export function resolveFontInfo(
  item: PdfJsTextItem,
  styles: Record<string, PdfJsStyle | undefined>,
): PdfFontInfo | null {
  const family = item.fontName ? styles[item.fontName]?.fontFamily ?? null : null;
  const lowered = family?.toLowerCase() ?? "";
  return {
    size: item.height,
    bold: lowered.includes("bold") || lowered.includes("black"),
    italic: lowered.includes("italic") || lowered.includes("oblique"),
    family,
  };
}

export function toCollectedTextItems(
  rawItems: Array<PdfJsTextItem | { type: unknown }>,
  styles: Record<string, PdfJsStyle | undefined>,
): CollectedTextItem[] {
  const collected: CollectedTextItem[] = [];
  for (const raw of rawItems) {
    const item = raw as PdfJsTextItem;
    if (typeof item.str !== "string") continue; // marked-content items
    collected.push({
      str: item.str,
      transform: item.transform,
      width: item.width,
      height: item.height,
      dir: item.dir || "ltr",
      font: resolveFontInfo(item, styles),
      hasEol: Boolean(item.hasEOL),
    });
  }
  return collected;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

async function renderRasterBase64(
  render: (canvas: HTMLCanvasElement, canvasContext: CanvasRenderingContext2D) => Promise<void>,
  width: number,
  height: number,
): Promise<string | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await render(canvas, context);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return null;
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  } catch (error) {
    console.warn("[PDF reflow] Analysis raster render failed; analyzing text-only", error);
    return null;
  }
}

export async function collectPageAnalysisInput(
  proxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<CollectedPageInput> {
  const page = await proxy.getPage(pageNumber);
  // Base geometry in UNROTATED user space: `RasterGeometry` (coordinates.rs)
  // binds the raster to the page's user-space size and applies the viewer
  // rotation itself, so the analyzer must receive the unrotated pageWidth/
  // pageHeight (the default `getViewport({scale: 1})` would swap them for
  // /Rotate 90/270 pages and desynchronize every PDF↔raster transform).
  const base = page.getViewport({ scale: 1, rotation: 0 });
  const scale = analysisScaleFor(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const rasterPngBase64 = await renderRasterBase64(
    async (canvas, context) => {
      await page.render({ canvasContext: context, viewport, canvas }).promise;
    },
    viewport.width,
    viewport.height,
  );

  // `disableCombineTextItems` is a real pdf.js option the installed typings
  // omit; the double cast keeps the call honest about that gap.
  const content = await page.getTextContent({
    disableCombineTextItems: true,
  } as unknown as Parameters<typeof page.getTextContent>[0]);
  const styles = (content.styles ?? {}) as Record<string, PdfJsStyle | undefined>;

  return {
    pageNumber,
    pageWidth: base.width,
    pageHeight: base.height,
    rotation: viewport.rotation ?? 0,
    rasterPngBase64,
    rasterScale: scale,
    textItems: toCollectedTextItems(content.items as Array<PdfJsTextItem | { type: unknown }>, styles),
  };
}
