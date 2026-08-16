/**
 * Crop geometry for source-region assets (task 6.2).
 *
 * The canonical model's rects live in UNROTATED PDF user space (origin
 * bottom-left, y up — see `src-tauri/src/pdf/coordinates.rs`). The crop
 * canvas, like the analysis raster, is rendered through a pdf.js viewport
 * that APPLIES the page's viewer rotation (0/90/180/270, clockwise), so the
 * crop rect must be mapped through the same rotation the raster uses.
 *
 * The per-rotation formulas below mirror `RasterGeometry::pdf_point_to_raster`:
 *
 * | rotation | pdf point → device     | normalized device rect                        |
 * |----------|------------------------|-----------------------------------------------|
 * | 0        | `vx = x·s, vy = (H−y)·s` | `left = x0/W, top = 1 − y1/H` (denoms W,H,W,H) |
 * | 90       | `vx = y·s, vy = x·s`    | `left = y0/H, top = x0/W` (denoms H,W,H,W)     |
 * | 180      | `vx = (W−x)·s, vy = y·s`| `left = 1 − x1/W, top = y0/H`                  |
 * | 270      | `vx = (H−y)·s, vy = (W−x)·s` | `left = 1 − y1/H, top = 1 − x1/W`         |
 *
 * For rotation 0 the arithmetic is byte-identical to the original inline
 * crop math in reflowAssets.ts (`(rect.x0 / base.width) * canvas.width` …).
 */
import type { PdfRect } from "../../types/pdfCanonical";

/** Source-rect of a crop in device pixels (top-left origin). */
export interface CropSourceRect {
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
}

/**
 * Map an unrotated user-space rect to the device-space crop rect of a canvas
 * rendered with the given viewer rotation, with `pad` pixels of padding on
 * each side (floored origin, ceiled size, clamped to the canvas edges).
 *
 * @param rect      model rect in unrotated PDF user space
 * @param baseW     unrotated user-space page width (pdf.js `rotation: 0` viewport)
 * @param baseH     unrotated user-space page height
 * @param rotation  viewer rotation baked into the crop canvas (0/90/180/270)
 * @param canvasW   crop canvas width in pixels
 * @param canvasH   crop canvas height in pixels
 * @param pad       padding in pixels on each side
 */
export function computeCropSourceRect(
  rect: PdfRect,
  baseW: number,
  baseH: number,
  rotation: number,
  canvasW: number,
  canvasH: number,
  pad: number,
): CropSourceRect {
  // Normalized left/top/width/height of the rect in the rotated canvas.
  let left: number;
  let top: number;
  let w: number;
  let h: number;
  switch (rotation) {
    case 90:
      left = rect.y0 / baseH;
      top = rect.x0 / baseW;
      w = (rect.y1 - rect.y0) / baseH;
      h = (rect.x1 - rect.x0) / baseW;
      break;
    case 180:
      left = 1 - rect.x1 / baseW;
      top = rect.y0 / baseH;
      w = (rect.x1 - rect.x0) / baseW;
      h = (rect.y1 - rect.y0) / baseH;
      break;
    case 270:
      left = 1 - rect.y1 / baseH;
      top = 1 - rect.x1 / baseW;
      w = (rect.y1 - rect.y0) / baseH;
      h = (rect.x1 - rect.x0) / baseW;
      break;
    default:
      left = rect.x0 / baseW;
      top = 1 - rect.y1 / baseH;
      w = (rect.x1 - rect.x0) / baseW;
      h = (rect.y1 - rect.y0) / baseH;
      break;
  }
  const sx = left * canvasW;
  const sy = top * canvasH;
  const sw = w * canvasW;
  const sh = h * canvasH;
  const srcX = Math.max(0, Math.floor(sx) - pad);
  const srcY = Math.max(0, Math.floor(sy) - pad);
  const srcW = Math.min(canvasW - srcX, Math.ceil(sw) + 2 * pad);
  const srcH = Math.min(canvasH - srcY, Math.ceil(sh) + 2 * pad);
  return { srcX, srcY, srcW, srcH };
}

/**
 * Padding for a crop of `w × h` device pixels: ~2–4 % expansion per the
 * design intent, capped at the historical 4px and always at least 1px, so a
 * thin strip's crop is no longer inflated by a pad comparable to the strip
 * itself (a 0.6pt rule used to grow to 10px).
 */
export function cropPadFor(w: number, h: number): number {
  return Math.min(4, Math.max(1, Math.round(0.04 * Math.min(w, h))));
}
