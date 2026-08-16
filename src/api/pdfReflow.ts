/**
 * Typed wrappers for the canonical PDF reflow commands (v2) in
 * `src-tauri/src/commands/pdf_reflow.rs`. Page payloads are the canonical
 * model from `src/types/pdfCanonical.ts`; assets are source-crop PNGs
 * (base64 in, ArrayBuffer out — Tauri IPC on Android is JSON-only, so this
 * matches the `ocr_image_bytes` precedent for binary-in).
 */
import { invokeCommand } from "../lib/tauri";
import type { PdfCanonicalPage } from "../types/pdfCanonical";

export interface PdfReflowCacheContext {
  documentId: string;
  sourceIdentity: string;
  schemaVersion: number;
  engineVersion: string;
}

/**
 * Run hybrid page analysis in Rust. `input` is the collected raster + text
 * items (`pdfCanonicalCollector.ts`); camelCase keys mirror
 * `PdfReflowAnalyzeInput` in `commands/pdf_reflow.rs`.
 */
export async function analyzePdfReflowPage(input: {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  rasterPngBase64: string | null;
  rasterScale: number;
  textItems: Array<{
    str: string;
    transform: number[];
    width: number;
    height: number;
    dir: string;
    font: { size: number; bold: boolean; italic: boolean; family: string | null } | null;
    hasEol: boolean;
  }>;
  marginalContext?: string[];
}): Promise<PdfCanonicalPage> {
  return await invokeCommand<PdfCanonicalPage>("pdf_reflow_analyze_page", { input });
}

export async function getPdfReflowPage(
  context: PdfReflowCacheContext,
  pageNumber: number,
): Promise<PdfCanonicalPage | null> {
  return await invokeCommand<PdfCanonicalPage | null>("pdf_reflow_get_page", {
    ...context,
    pageNumber,
  });
}

export async function putPdfReflowPage(
  context: PdfReflowCacheContext,
  page: PdfCanonicalPage,
): Promise<void> {
  await invokeCommand<void>("pdf_reflow_put_page", { ...context, page });
}

/** Store a source-crop PNG; resolves to its content-hash asset id. */
export async function putPdfReflowAsset(
  context: PdfReflowCacheContext,
  imageBase64: string,
): Promise<string> {
  return await invokeCommand<string>("pdf_reflow_put_asset", {
    ...context,
    imageBase64,
  });
}

/** Fetch a source-crop asset; `null` when not cached. */
export async function getPdfReflowAsset(
  context: PdfReflowCacheContext,
  assetId: string,
): Promise<Uint8Array | null> {
  const buffer = await invokeCommand<ArrayBuffer>("pdf_reflow_get_asset", {
    ...context,
    assetId,
  });
  if (!buffer || buffer.byteLength === 0) return null;
  return new Uint8Array(buffer);
}

/** Canonical selection resolved against a cached page (word-level snapping). */
export interface ResolvedPdfReflowSelection {
  startWordId: string;
  endWordId: string;
  wordIds: string[];
  text: string;
  pageRegions: Array<{
    pageNumber: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

/** Resolve PDF-space rects (x0/y0/x1/y1 tuples) to canonical word IDs. */
export async function resolvePdfReflowSelection(
  context: PdfReflowCacheContext,
  pageNumber: number,
  rects: Array<[number, number, number, number]>,
): Promise<ResolvedPdfReflowSelection | null> {
  return await invokeCommand<ResolvedPdfReflowSelection | null>(
    "pdf_reflow_resolve_selection",
    { ...context, pageNumber, rects },
  );
}

/** Reconstruct per-line highlight regions for a stored word-ID range. */
export async function pdfReflowSelectionRects(
  context: PdfReflowCacheContext,
  pageNumber: number,
  startWordId: string,
  endWordId: string,
): Promise<ResolvedPdfReflowSelection["pageRegions"] | null> {
  return await invokeCommand<ResolvedPdfReflowSelection["pageRegions"] | null>(
    "pdf_reflow_selection_rects",
    { ...context, pageNumber, startWordId, endWordId },
  );
}

/** Remove all cached reflow data (v2 + legacy v1) for one document. */
export async function deletePdfReflowCacheV2(documentId: string): Promise<void> {
  await invokeCommand<void>("pdf_reflow_delete_cache", { documentId });
}
