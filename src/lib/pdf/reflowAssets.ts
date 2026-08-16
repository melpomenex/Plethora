/**
 * Source-crop asset pipeline (task 6.2): figures/equations/table-crops are
 * rendered from the pdf.js document at print resolution on demand, uploaded
 * to the Rust asset cache (content-hash dedupe), and served back as object
 * URLs for the reflow renderer. Original visual content is preserved —
 * never re-created (D7).
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPdfReflowAsset, putPdfReflowAsset, type PdfReflowCacheContext } from "../../api/pdfReflow";
import { computeCropSourceRect, cropPadFor } from "./cropGeometry";
import type { PdfRect } from "../../types/pdfCanonical";

/** Render crops at ~2× the page display scale — print-quality, bounded. */
const CROP_RENDER_SCALE = 2.0;

const objectUrlCache = new Map<string, string>();

export function assetCacheKey(documentId: string, blockId: string): string {
  return `${documentId}:${blockId}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * A stored source crop: its content-hash asset id plus the crop canvas's
 * pixel size. The dims are the renderer's intrinsic-aspect basis — they
 * reserve layout space before the PNG loads.
 */
export interface PdfRegionAsset {
  assetId: string;
  width: number;
  height: number;
}

/**
 * Render one PDF-space region to PNG, store it in the native asset cache,
 * and return its content-hash asset id with the crop's pixel dims. Returns
 * null when rendering or the canvas is unavailable — callers show the
 * original-view fallback.
 */
export async function renderAndStoreRegionAsset(params: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  rect: PdfRect;
  context: PdfReflowCacheContext;
}): Promise<PdfRegionAsset | null> {
  const { pdf, pageNumber, rect, context } = params;
  try {
    const page = await pdf.getPage(pageNumber);
    // Base geometry is in the model rect's basis: UNROTATED user space
    // (rotation: 0), matching the analysis basis (coordinates.rs keeps
    // canonical rects in unrotated user space).
    const base = page.getViewport({ scale: 1, rotation: 0 });
    // The crop canvas applies the page's viewer rotation (like the analysis
    // raster); computeCropSourceRect maps the unrotated rect through it.
    // For rotation 0 the pixel math is identical to the original inline form.
    const viewport = page.getViewport({ scale: CROP_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) return null;
    canvasContext.fillStyle = "#ffffff";
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext, viewport, canvas }).promise;
    // Crop in device pixels (top-left origin — same basis as viewport).
    // First estimate the crop size at pad 0 to scale the pad with the crop
    // (thin strips must not be inflated by a full 4px pad on each side).
    const zero = computeCropSourceRect(
      rect,
      base.width,
      base.height,
      viewport.rotation ?? 0,
      canvas.width,
      canvas.height,
      0,
    );
    const pad = cropPadFor(zero.srcW, zero.srcH);
    const { srcX, srcY, srcW, srcH } = computeCropSourceRect(
      rect,
      base.width,
      base.height,
      viewport.rotation ?? 0,
      canvas.width,
      canvas.height,
      pad,
    );
    const crop = document.createElement("canvas");
    crop.width = Math.max(1, srcW);
    crop.height = Math.max(1, srcH);
    const cropContext = crop.getContext("2d");
    if (!cropContext) return null;
    cropContext.fillStyle = "#ffffff";
    cropContext.fillRect(0, 0, crop.width, crop.height);
    cropContext.drawImage(
      canvas,
      srcX,
      srcY,
      srcW,
      srcH,
      0,
      0,
      srcW,
      srcH,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      crop.toBlob(resolve, "image/png"),
    );
    if (!blob) return null;
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const assetId = await putPdfReflowAsset(context, base64);
    if (!assetId) return null;
    return { assetId, width: crop.width, height: crop.height };
  } catch (error) {
    console.warn("[PDF reflow] Region crop render failed", error);
    return null;
  }
}

/** Fetch a cached asset as an object URL (cached per asset id). */
export async function fetchAssetObjectUrl(
  context: PdfReflowCacheContext,
  assetId: string,
): Promise<string | null> {
  const cached = objectUrlCache.get(assetId);
  if (cached) return cached;
  if (typeof URL?.createObjectURL !== "function") return null;
  try {
    const bytes = await getPdfReflowAsset(context, assetId);
    if (!bytes) return null;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
    objectUrlCache.set(assetId, url);
    return url;
  } catch (error) {
    console.warn("[PDF reflow] Asset fetch failed", error);
    return null;
  }
}

/** Render + store + fetch in one step: block key → object URL + crop dims. */
export async function ensureRegionAssetUrl(params: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  rect: PdfRect;
  context: PdfReflowCacheContext;
}): Promise<{ url: string; width: number; height: number } | null> {
  const asset = await renderAndStoreRegionAsset(params);
  if (!asset) return null;
  const url = await fetchAssetObjectUrl(params.context, asset.assetId);
  if (!url) return null;
  return { url, width: asset.width, height: asset.height };
}

/** test-only: drop object URL cache entries. */
export function clearAssetUrlCache(): void {
  for (const url of objectUrlCache.values()) {
    if (typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
}
