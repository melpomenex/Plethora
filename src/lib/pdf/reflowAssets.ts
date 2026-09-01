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
import { withPdfRenderLock } from "./pdfRenderLock";
import type { PdfRect } from "../../types/pdfCanonical";

/** Render crops at ~2× the page display scale — print-quality, bounded. */
const CROP_RENDER_SCALE = 2.0;

const objectUrlCache = new Map<string, string>();
/** documentId -> asset ids with live object URLs in the module cache. */
const documentAssetIds = new Map<string, Set<string>>();
/** Bumped on release so in-flight renders skip re-caching after close. */
const documentGenerations = new Map<string, number>();

function documentGeneration(documentId: string): number {
  return documentGenerations.get(documentId) ?? 0;
}

function trackDocumentAsset(documentId: string, assetId: string): void {
  let ids = documentAssetIds.get(documentId);
  if (!ids) {
    ids = new Set();
    documentAssetIds.set(documentId, ids);
  }
  ids.add(assetId);
}

function cacheObjectUrl(documentId: string, assetId: string, objectUrl: string, generation: number): void {
  if (generation !== documentGeneration(documentId)) {
    if (typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
    return;
  }
  objectUrlCache.set(assetId, objectUrl);
  trackDocumentAsset(documentId, assetId);
}

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
  const generation = documentGeneration(context.documentId);
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
    await withPdfRenderLock(() =>
      page.render({ canvasContext, viewport, canvas }).promise,
    );
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

    // Create and cache the object URL immediately in memory so the frontend
    // can display the inline figure without waiting for IPC or disk I/O.
    let objectUrl: string | null = null;
    if (typeof URL?.createObjectURL === "function") {
      try {
        objectUrl = URL.createObjectURL(blob);
      } catch {
        // Mock blob or non-standard environment
      }
    }

    let assetId = "";
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      assetId = await putPdfReflowAsset(context, base64);
      if (assetId && objectUrl) {
        cacheObjectUrl(context.documentId, assetId, objectUrl, generation);
      }
    } catch (putError) {
      console.debug("[PDF reflow] Native asset cache write non-fatal:", putError);
      assetId = `mem-${pageNumber}-${srcX}-${srcY}`;
      if (objectUrl) {
        cacheObjectUrl(context.documentId, assetId, objectUrl, generation);
      }
    }

    return { assetId: assetId || "memory-asset", width: crop.width, height: crop.height };
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
  const generation = documentGeneration(context.documentId);
  try {
    const bytes = await getPdfReflowAsset(context, assetId);
    if (!bytes) return null;
    if (generation !== documentGeneration(context.documentId)) return null;
    try {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      cacheObjectUrl(context.documentId, assetId, url, generation);
      return url;
    } catch {
      return null;
    }
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
  const url = (asset.assetId && objectUrlCache.get(asset.assetId)) || await fetchAssetObjectUrl(params.context, asset.assetId);
  if (!url) return null;
  return { url, width: asset.width, height: asset.height };
}

/** Revoke in-memory reflow object URLs and abandon in-flight cache writes for one document. */
export function releaseDocumentResources(documentId: string): void {
  documentGenerations.set(documentId, documentGeneration(documentId) + 1);
  const assetIds = documentAssetIds.get(documentId);
  if (!assetIds) return;
  for (const assetId of assetIds) {
    let referencedElsewhere = false;
    for (const [otherDocId, ids] of documentAssetIds.entries()) {
      if (otherDocId !== documentId && ids.has(assetId)) {
        referencedElsewhere = true;
        break;
      }
    }
    if (!referencedElsewhere) {
      const url = objectUrlCache.get(assetId);
      if (url && typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(url);
      objectUrlCache.delete(assetId);
    }
  }
  documentAssetIds.delete(documentId);
}

/** test-only: drop object URL cache entries. */
export function clearAssetUrlCache(): void {
  for (const url of objectUrlCache.values()) {
    if (typeof URL?.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
  documentAssetIds.clear();
  documentGenerations.clear();
}

