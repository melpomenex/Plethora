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

/** Remove all cached reflow data (v2 + legacy v1) for one document. */
export async function deletePdfReflowCacheV2(documentId: string): Promise<void> {
  await invokeCommand<void>("pdf_reflow_delete_cache", { documentId });
}
