import * as pdfjsLib from "pdfjs-dist";
import type { PDFPageProxy, PageViewport } from "pdfjs-dist";
import { withPdfRenderLock } from "./pdfRenderLock";

export interface PdfUserRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfImageRegion {
  /** Stable identifier for this image region on the page (e.g. "img-0"). */
  id: string;
  /** Axis-aligned bounding box in unrotated PDF user space. */
  pdfRect: PdfUserRect;
}

export interface OperatorListLike {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<any>;
}

export interface ViewportLike {
  transform: ArrayLike<number>;
  width: number;
  height: number;
}

type Matrix6 = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];

/** Minimum image dimension in PDF points (~1/3 inch) to exclude 1px spacers, bullets, and rules. */
const MIN_IMAGE_PDF_POINTS = 24;

/** Minimum rendered CSS pixel dimension before showing the hover overlay. */
export const MIN_IMAGE_CSS_PX = 36;

/** Tolerance in PDF points for merging adjacent tiled/striped image slices. */
const TILE_MERGE_TOLERANCE_PT = 2.5;

/** Target render scale for crisp image extraction (2x PDF points). */
const EXPORT_RENDER_SCALE = 2.0;

/** Cap exported crop canvas to 4MP (~2048x2048) to keep memory bounded. */
const MAX_EXPORT_PIXELS = 4_194_304;

export function multiplyMatrices(m1: Matrix6, m2: ArrayLike<number>): Matrix6 {
  const a1 = m1[0], b1 = m1[1], c1 = m1[2], d1 = m1[3], e1 = m1[4], f1 = m1[5];
  const a2 = m2[0], b2 = m2[1], c2 = m2[2], d2 = m2[3], e2 = m2[4], f2 = m2[5];
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function transformRectByMatrix(rect: PdfUserRect, m: ArrayLike<number>): PdfUserRect {
  const corners: [number, number][] = [
    [rect.x0, rect.y0],
    [rect.x1, rect.y0],
    [rect.x0, rect.y1],
    [rect.x1, rect.y1],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const tx = m[0] * x + m[2] * y + m[4];
    const ty = m[1] * x + m[3] * y + m[5];
    if (tx < minX) minX = tx;
    if (ty < minY) minY = ty;
    if (tx > maxX) maxX = tx;
    if (ty > maxY) maxY = ty;
  }
  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}

function intersectUserRects(a: PdfUserRect, b: PdfUserRect): PdfUserRect | null {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function unionUserRects(a: PdfUserRect, b: PdfUserRect): PdfUserRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function shouldMergeImageRects(a: PdfUserRect, b: PdfUserRect): boolean {
  const tol = TILE_MERGE_TOLERANCE_PT;

  // Vertical strips sharing the same horizontal span and touching/overlapping vertically.
  const sameXSpan = Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.x1 - b.x1) <= tol;
  const touchY = b.y0 <= a.y1 + tol && a.y0 <= b.y1 + tol;
  if (sameXSpan && touchY) return true;

  // Horizontal strips sharing the same vertical span and touching/overlapping horizontally.
  const sameYSpan = Math.abs(a.y0 - b.y0) <= tol && Math.abs(a.y1 - b.y1) <= tol;
  const touchX = b.x0 <= a.x1 + tol && a.x0 <= b.x1 + tol;
  if (sameYSpan && touchX) return true;

  // Nearly identical / duplicate painted images (e.g. image + mask overlay at same bounds).
  const inter = intersectUserRects(a, b);
  if (inter) {
    const interArea = (inter.x1 - inter.x0) * (inter.y1 - inter.y0);
    const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
    const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
    const maxArea = Math.max(areaA, areaB);
    if (maxArea > 0 && interArea / maxArea >= 0.92) {
      return true;
    }
  }

  return false;
}

/**
 * Merge adjacent tiled/striped image slices and near-duplicate draws into
 * single cohesive image regions.
 */
export function mergeAdjacentImageRects(rects: readonly PdfUserRect[]): PdfUserRect[] {
  const result = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (shouldMergeImageRects(result[i], result[j])) {
          result[i] = unionUserRects(result[i], result[j]);
          result.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }
  return result;
}

const UNIT_SQUARE: PdfUserRect = { x0: 0, y0: 0, x1: 1, y1: 1 };

/**
 * pdf.js operator codes used for image-region extraction. Matches `pdfjsLib.OPS`
 * in pdfjs-dist v5 with safe numeric fallbacks for mocked test environments.
 */
export const PDF_IMAGE_OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  paintImageMaskXObject: 83,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
} as const;

function resolvePdfImageOps() {
  try {
    const ops = (pdfjsLib as unknown as { OPS?: Partial<typeof PDF_IMAGE_OPS> }).OPS;
    if (!ops) return PDF_IMAGE_OPS;
    return {
      save: ops.save ?? PDF_IMAGE_OPS.save,
      restore: ops.restore ?? PDF_IMAGE_OPS.restore,
      transform: ops.transform ?? PDF_IMAGE_OPS.transform,
      paintFormXObjectBegin: ops.paintFormXObjectBegin ?? PDF_IMAGE_OPS.paintFormXObjectBegin,
      paintFormXObjectEnd: ops.paintFormXObjectEnd ?? PDF_IMAGE_OPS.paintFormXObjectEnd,
      beginGroup: ops.beginGroup ?? PDF_IMAGE_OPS.beginGroup,
      endGroup: ops.endGroup ?? PDF_IMAGE_OPS.endGroup,
      paintImageMaskXObject: ops.paintImageMaskXObject ?? PDF_IMAGE_OPS.paintImageMaskXObject,
      paintImageXObject: ops.paintImageXObject ?? PDF_IMAGE_OPS.paintImageXObject,
      paintInlineImageXObject: ops.paintInlineImageXObject ?? PDF_IMAGE_OPS.paintInlineImageXObject,
    };
  } catch {
    return PDF_IMAGE_OPS;
  }
}

/**
 * Walk a pdf.js operator list and return the bounding boxes (in unrotated PDF
 * user space) of all meaningful images painted on the page.
 */
export function extractImageRegionsFromOperatorList(
  operatorList: OperatorListLike,
  pageViewBox?: readonly [number, number, number, number] | number[] | null,
): PdfImageRegion[] {
  const OPS = resolvePdfImageOps();
  const viewRect: PdfUserRect | null =
    pageViewBox && pageViewBox.length >= 4
      ? {
          x0: Math.min(pageViewBox[0], pageViewBox[2]),
          y0: Math.min(pageViewBox[1], pageViewBox[3]),
          x1: Math.max(pageViewBox[0], pageViewBox[2]),
          y1: Math.max(pageViewBox[1], pageViewBox[3]),
        }
      : null;

  let ctm: Matrix6 = IDENTITY_MATRIX;
  let currentClip: PdfUserRect | null = viewRect;
  const ctmStack: Matrix6[] = [];
  const clipStack: Array<PdfUserRect | null> = [];
  const groupSmaskStack: boolean[] = [];
  let smaskDepth = 0;

  const rawRects: PdfUserRect[] = [];
  const { fnArray, argsArray } = operatorList;
  const count = fnArray.length;

  for (let i = 0; i < count; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    switch (fn) {
      case OPS.save:
        ctmStack.push(ctm);
        clipStack.push(currentClip);
        break;
      case OPS.restore:
        ctm = ctmStack.pop() ?? IDENTITY_MATRIX;
        currentClip = clipStack.pop() ?? viewRect;
        break;
      case OPS.transform:
        if (args && args.length >= 6) {
          ctm = multiplyMatrices(ctm, args);
        }
        break;
      case OPS.paintFormXObjectBegin: {
        ctmStack.push(ctm);
        clipStack.push(currentClip);
        const matrix = args?.[0];
        const bbox = args?.[1];
        if (matrix && matrix.length >= 6) {
          ctm = multiplyMatrices(ctm, matrix);
        }
        if (bbox && bbox.length >= 4) {
          const formRect = transformRectByMatrix(
            {
              x0: Math.min(bbox[0], bbox[2]),
              y0: Math.min(bbox[1], bbox[3]),
              x1: Math.max(bbox[0], bbox[2]),
              y1: Math.max(bbox[1], bbox[3]),
            },
            ctm,
          );
          currentClip = currentClip ? intersectUserRects(currentClip, formRect) : formRect;
        }
        break;
      }
      case OPS.paintFormXObjectEnd:
        ctm = ctmStack.pop() ?? IDENTITY_MATRIX;
        currentClip = clipStack.pop() ?? viewRect;
        break;
      case OPS.beginGroup: {
        ctmStack.push(ctm);
        clipStack.push(currentClip);
        const isSmask = Boolean(args?.[0]?.smask);
        groupSmaskStack.push(isSmask);
        if (isSmask) smaskDepth++;
        break;
      }
      case OPS.endGroup: {
        ctm = ctmStack.pop() ?? IDENTITY_MATRIX;
        currentClip = clipStack.pop() ?? viewRect;
        if (groupSmaskStack.pop()) {
          smaskDepth = Math.max(0, smaskDepth - 1);
        }
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject: {
        if (smaskDepth > 0) break;
        let rect: PdfUserRect | null = transformRectByMatrix(UNIT_SQUARE, ctm);
        if (currentClip) {
          rect = intersectUserRects(rect, currentClip);
        }
        if (
          rect &&
          Number.isFinite(rect.x0) &&
          Number.isFinite(rect.y0) &&
          Number.isFinite(rect.x1) &&
          Number.isFinite(rect.y1) &&
          rect.x1 - rect.x0 > 0 &&
          rect.y1 - rect.y0 > 0
        ) {
          rawRects.push(rect);
        }
        break;
      }
    }
  }

  if (rawRects.length === 0) return [];

  const merged = mergeAdjacentImageRects(rawRects);
  const filtered = merged.filter(
    (r) => r.x1 - r.x0 >= MIN_IMAGE_PDF_POINTS && r.y1 - r.y0 >= MIN_IMAGE_PDF_POINTS,
  );

  return filtered.map((pdfRect, index) => ({
    id: `img-${index}`,
    pdfRect,
  }));
}

/**
 * Extract all saveable image regions from a rendered pdf.js page.
 */
export async function extractPdfPageImageRegions(
  pdfPage: PDFPageProxy,
): Promise<PdfImageRegion[]> {
  const operatorList = await pdfPage.getOperatorList();
  return extractImageRegionsFromOperatorList(operatorList, pdfPage.view);
}

/**
 * Project a PDF user-space rect into viewport CSS pixels, clamped to the page bounds.
 */
export function pdfRectToViewportRect(
  pdfRect: PdfUserRect,
  viewport: ViewportLike,
): PdfViewportRect | null {
  const projected = transformRectByMatrix(pdfRect, viewport.transform);
  const left = Math.max(0, Math.min(viewport.width, projected.x0));
  const top = Math.max(0, Math.min(viewport.height, projected.y0));
  const right = Math.max(0, Math.min(viewport.width, projected.x1));
  const bottom = Math.max(0, Math.min(viewport.height, projected.y1));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

/**
 * Hit-test a pointer position (in viewport CSS pixels) against a page's image
 * regions. When multiple regions overlap, picks the smallest-area region so
 * inset images win over full-page backgrounds.
 */
export function hitTestPdfImageRegions(
  regions: readonly PdfImageRegion[],
  viewport: ViewportLike,
  vx: number,
  vy: number,
  minCssSize = MIN_IMAGE_CSS_PX,
): { region: PdfImageRegion; viewportRect: PdfViewportRect } | null {
  let best: { region: PdfImageRegion; viewportRect: PdfViewportRect; area: number } | null = null;
  for (const region of regions) {
    const rect = pdfRectToViewportRect(region.pdfRect, viewport);
    if (!rect) continue;
    if (rect.width < minCssSize || rect.height < minCssSize) continue;
    if (
      vx >= rect.left &&
      vx <= rect.left + rect.width &&
      vy >= rect.top &&
      vy <= rect.top + rect.height
    ) {
      const area = rect.width * rect.height;
      if (!best || area < best.area) {
        best = { region, viewportRect: rect, area };
      }
    }
  }
  return best ? { region: best.region, viewportRect: best.viewportRect } : null;
}

/**
 * Convert a page-local viewport CSS rect to screen client coordinates,
 * optionally clamped to the visible bounds of the scroll container so the
 * floating save overlay stays inside the visible portion of tall images.
 */
export function viewportRectToClientRect(
  viewportRect: PdfViewportRect,
  pageClientRect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  clipClientRect?: { left: number; top: number; right: number; bottom: number } | null,
): PdfViewportRect | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const scaleX = pageClientRect.width / viewport.width;
  const scaleY = pageClientRect.height / viewport.height;

  let left = pageClientRect.left + viewportRect.left * scaleX;
  let top = pageClientRect.top + viewportRect.top * scaleY;
  let right = left + viewportRect.width * scaleX;
  let bottom = top + viewportRect.height * scaleY;

  if (clipClientRect) {
    left = Math.max(left, clipClientRect.left);
    top = Math.max(top, clipClientRect.top);
    right = Math.min(right, clipClientRect.right);
    bottom = Math.min(bottom, clipClientRect.bottom);
  }

  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function cropFromFallbackCanvas(
  canvas: HTMLCanvasElement,
  viewport: ViewportLike,
  pdfRect: PdfUserRect,
): Promise<Blob> {
  const viewportRect = pdfRectToViewportRect(pdfRect, viewport);
  if (!viewportRect) {
    return Promise.reject(new Error("Image region is outside the page bounds"));
  }
  const scaleX = canvas.width / viewport.width;
  const scaleY = canvas.height / viewport.height;
  const srcX = Math.max(0, Math.floor(viewportRect.left * scaleX));
  const srcY = Math.max(0, Math.floor(viewportRect.top * scaleY));
  const srcW = Math.max(1, Math.min(canvas.width - srcX, Math.round(viewportRect.width * scaleX)));
  const srcH = Math.max(1, Math.min(canvas.height - srcY, Math.round(viewportRect.height * scaleY)));

  const crop = document.createElement("canvas");
  crop.width = srcW;
  crop.height = srcH;
  const ctx = crop.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas rendering is unavailable"));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, srcW, srcH);
  ctx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  return new Promise<Blob>((resolve, reject) => {
    crop.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode PDF image"));
    }, "image/png");
  });
}

/**
 * Render a crisp PNG Blob of a single PDF image region. Uses an offscreen
 * cropped render at high resolution (respecting page rotation, clipping, and
 * alpha compositing), with a fallback to cropping the already-rendered page canvas.
 */
export async function extractPdfImageRegionBlob(params: {
  pdfPage: PDFPageProxy;
  pageNumber: number;
  region: PdfImageRegion;
  fallbackCanvas?: HTMLCanvasElement | null;
  fallbackViewport?: PageViewport | null;
}): Promise<{ blob: Blob; fileName: string }> {
  const { pdfPage, pageNumber, region, fallbackCanvas, fallbackViewport } = params;
  const fileName = `pdf-page-${pageNumber}-image-${Date.now()}.png`;

  try {
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const baseRect = pdfRectToViewportRect(region.pdfRect, baseViewport);
    if (!baseRect) {
      throw new Error("Image region is outside the page bounds");
    }

    let renderScale = EXPORT_RENDER_SCALE;
    const targetPixels = baseRect.width * renderScale * (baseRect.height * renderScale);
    if (targetPixels > MAX_EXPORT_PIXELS) {
      renderScale = Math.max(0.5, Math.sqrt(MAX_EXPORT_PIXELS / (baseRect.width * baseRect.height)));
    }

    const viewport = pdfPage.getViewport({ scale: renderScale });
    const cropRect = pdfRectToViewportRect(region.pdfRect, viewport);
    if (!cropRect) {
      throw new Error("Image region is outside the page bounds");
    }

    const cropX = Math.floor(cropRect.left);
    const cropY = Math.floor(cropRect.top);
    const cropW = Math.max(1, Math.round(cropRect.width));
    const cropH = Math.max(1, Math.round(cropRect.height));

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is unavailable");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cropW, cropH);

    await withPdfRenderLock(() =>
      pdfPage.render({
        canvasContext: ctx,
        viewport,
        transform: [1, 0, 0, 1, -cropX, -cropY],
        canvas,
      }).promise,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Failed to encode PDF image");
    return { blob, fileName };
  } catch (err) {
    if (fallbackCanvas && fallbackViewport) {
      const blob = await cropFromFallbackCanvas(fallbackCanvas, fallbackViewport, region.pdfRect);
      return { blob, fileName };
    }
    throw err;
  }
}
