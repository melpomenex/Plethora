/**
 * The only sanctioned coordinate conversions on the TS side (design D4) —
 * mirrors `src-tauri/src/pdf/coordinates.rs` exactly. Raster space here is
 * pdf.js *viewport* space (origin top-left, y down, `scale` px per point,
 * `rotation` already applied), which the Rust side treats as raster space.
 *
 * Legacy rects elsewhere in the app use `{x1, y1, x2, y2}`; converters at
 * the bottom bridge those during the migration.
 */
import type { PdfRect } from "../../types/pdfCanonical";
import type { PdfRect as LegacyPdfRect } from "../../types/selection";

export interface RasterGeometry {
  width: number;
  height: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  pageWidth: number;
  pageHeight: number;
}

export interface RasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pdfPointToRaster(
  x: number,
  y: number,
  geometry: RasterGeometry,
): [number, number] {
  const s = geometry.scale;
  const { pageWidth: w, pageHeight: h, rotation } = geometry;
  switch (rotation) {
    case 90:
      return [y * s, x * s];
    case 180:
      return [(w - x) * s, y * s];
    case 270:
      return [(h - y) * s, (w - x) * s];
    default:
      return [x * s, (h - y) * s];
  }
}

export function rasterPointToPdf(
  vx: number,
  vy: number,
  geometry: RasterGeometry,
): [number, number] {
  const s = geometry.scale;
  const { pageWidth: w, pageHeight: h, rotation } = geometry;
  switch (rotation) {
    case 90:
      return [vy / s, vx / s];
    case 180:
      return [w - vx / s, vy / s];
    case 270:
      return [w - vy / s, h - vx / s];
    default:
      return [vx / s, h - vy / s];
  }
}

export function pdfRectToRaster(rect: PdfRect, geometry: RasterGeometry): RasterRect {
  const [ax, ay] = pdfPointToRaster(rect.x0, rect.y0, geometry);
  const [bx, by] = pdfPointToRaster(rect.x1, rect.y1, geometry);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(ax - bx),
    height: Math.abs(ay - by),
  };
}

export function rasterRectToPdf(rect: RasterRect, geometry: RasterGeometry): PdfRect {
  const [ax, ay] = rasterPointToPdf(rect.x, rect.y, geometry);
  const [bx, by] = rasterPointToPdf(rect.x + rect.width, rect.y + rect.height, geometry);
  return {
    x0: Math.min(ax, bx),
    y0: Math.min(ay, by),
    x1: Math.max(ax, bx),
    y1: Math.max(ay, by),
  };
}

/** Union of rects; empty input → null. */
export function unionPdfRects(rects: PdfRect[]): PdfRect | null {
  if (rects.length === 0) return null;
  return rects.reduce((acc, rect) => ({
    x0: Math.min(acc.x0, rect.x0),
    y0: Math.min(acc.y0, rect.y0),
    x1: Math.max(acc.x1, rect.x1),
    y1: Math.max(acc.y1, rect.y1),
  }));
}

// --- Legacy bridges (migrate call sites onto the canonical functions) ---

export function canonicalFromLegacyRect(rect: LegacyPdfRect): PdfRect {
  return {
    x0: Math.min(rect.x1, rect.x2),
    y0: Math.min(rect.y1, rect.y2),
    x1: Math.max(rect.x1, rect.x2),
    y1: Math.max(rect.y1, rect.y2),
  };
}

export function legacyFromCanonicalRect(rect: PdfRect): LegacyPdfRect {
  return { x1: rect.x0, y1: rect.y0, x2: rect.x1, y2: rect.y1 };
}
