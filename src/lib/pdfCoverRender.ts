/**
 * Render a PDF document's first page to a JPEG data URL for use as a grid-view
 * cover image.
 *
 * The existing PDF cover pipeline (`extract_pdf_cover_data_url` in Rust) only
 * extracts *embedded* raster images (JPEG/JP2) that happen to live on page 1.
 * Most PDFs (text/vector content, academic papers) have none, so they fall
 * through to the icon placeholder. This helper fills that gap by *rendering*
 * page 1 to an offscreen `<canvas>` via the already-installed `pdfjs-dist`,
 * reusing the same worker + native range-transport setup the viewer uses.
 *
 * The returned data URL is persisted with `cover_image_source = "rendered"`,
 * so it is cached and not re-rendered on every grid load.
 *
 * Pure browser/Tauri only — not available in SSR or when `pdfjs-dist`/`Worker`
 * are unavailable (e.g. Node test runs, where pdfjs is mocked). In those cases
 * the helper resolves to `null` and the caller falls back to the icon.
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createNativePdfRangeSource } from "../components/viewer/nativePdfRangeTransport";

/** Target output width (px). ~2x the cover tile height for retina sharpness. */
const TARGET_WIDTH = 400;
/** JPEG encode quality — covers are decorative, so favour smaller data URLs. */
const JPEG_QUALITY = 0.7;
/** Hard time budget. Pathological/encrypted PDFs must never jank the grid. */
const RENDER_TIMEOUT_MS = 8000;

export interface RenderPdfCoverOptions {
  /** Render budget in ms. Defaults to {@link RENDER_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Render page 1 of an already-loaded PDF document proxy to a JPEG data URL.
 *
 * Exposed (and exported) primarily so it can be unit-tested with a fake
 * `PDFDocumentProxy` without going through the worker/transport layer.
 */
export async function renderFirstPageToDataUrl(
  pdf: PDFDocumentProxy,
  options: RenderPdfCoverOptions = {},
): Promise<string | null> {
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  // Scale so the output is ~TARGET_WIDTH wide, but never upscale beyond the
  // page's native width (pointless detail + larger payload for tiny pages).
  const scale = baseViewport.width >= TARGET_WIDTH ? TARGET_WIDTH / baseViewport.width : 1;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) return null;

  // The background must be opaque white — PDFs are transparent by default, so
  // an unset canvas background yields black where the page is meant to be white.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  // Release page resources promptly; cover renders are one-shot.
  page.cleanup();
  return dataUrl;
}

/**
 * Open and render page 1 of a PDF document (by Tauri document id) to a JPEG
 * data URL. Returns `null` on any error or timeout — callers should keep the
 * existing icon placeholder in that case.
 *
 * Uses the native range transport (streaming read of the on-disk PDF via the
 * Rust `read_pdf_document_range` command), matching the viewer's load path so
 * the worker is exercised identically on desktop and Android.
 */
export async function renderPdfCover(
  documentId: string,
  options: RenderPdfCoverOptions = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS;

  try {
    const dataUrl = await Promise.race([
      renderPdfDocumentCover(documentId),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return dataUrl;
  } catch (error) {
    console.warn(`[pdfCoverRender] failed to render cover for ${documentId}:`, error);
    return null;
  }
}

async function renderPdfDocumentCover(documentId: string): Promise<string | null> {
  const native = await createNativePdfRangeSource(documentId);
  let pdf: PDFDocumentProxy | null = null;
  try {
    pdf = await Promise.race([
      pdfjsLib.getDocument({
        range: native.transport,
        length: native.info.size,
        verbosity: 0,
        disableStream: true,
        disableAutoFetch: false,
      } as any).promise,
      // Surface source/transport failures (already normalized) instead of hanging.
      native.failure,
    ]);
    return await renderFirstPageToDataUrl(pdf);
  } finally {
    pdf?.destroy?.();
    native.transport.abort();
  }
}
