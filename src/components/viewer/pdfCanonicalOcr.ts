/**
 * Canonical OCR orchestration (tasks 7.2–7.4): for pages the analyzer marks
 * `ocr-required`, run the pluggable local engine and ingest the words into
 * the canonical model. Engine routing reuses the existing OCR stack —
 * `ocrImageBytes` already tries Android MLKit/AICore first and falls back to
 * the configured Rust providers, and `performOCRWithProgress` covers the
 * browser demo. Graphical fallback covers pages where OCR is unavailable or
 * declined (task 7.5).
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { invokeCommand } from "../../lib/tauri";
import { ocrImageBytes } from "../../api/ocrCommands";
import type { PdfCanonicalPage } from "../../types/pdfCanonical";
import type { PdfReflowCacheContext } from "../../api/pdfReflow";
import { collectPageAnalysisInput } from "./pdfCanonicalCollector";

/** OCR render size cap — matches the v1 OCR path (≤2400px). */
const OCR_MAX_EDGE = 2400;

export interface OcrWordResult {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

async function renderPageBase64(proxy: PDFDocumentProxy, pageNumber: number): Promise<{
  base64: string;
  width: number;
  height: number;
} | null> {
  try {
    const page = await proxy.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(OCR_MAX_EDGE / Math.max(base.width, base.height), 3.0);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
    }
    return { base64: btoa(binary), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

/** OCR engine labels → normalized word inputs (0..1, top-left origin). */
export async function recognizePageWords(
  proxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ words: OcrWordResult[]; pageWidth: number; pageHeight: number } | null> {
  const rendered = await renderPageBase64(proxy, pageNumber);
  if (!rendered) return null;
  const page = await proxy.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  try {
    const response = await ocrImageBytes({ image_data: rendered.base64 });
    if (!response.success) return null;
    const words: OcrWordResult[] = [];
    for (const line of response.lines ?? []) {
      const bbox = line.bbox_percent;
      if (!bbox) continue;
      const [xPercent, yPercent, wPercent, hPercent] = bbox;
      words.push({
        text: line.text,
        x: xPercent / 100,
        y: yPercent / 100,
        width: wPercent / 100,
        height: hPercent / 100,
        confidence: line.confidence,
      });
    }
    if (words.length === 0) return null;
    return { words, pageWidth: base.width, pageHeight: base.height };
  } catch {
    return null;
  }
}

/** Run OCR on an ocr-required page and store the canonical result. */
export async function ocrCanonicalPage(params: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  context: PdfReflowCacheContext;
}): Promise<PdfCanonicalPage | null> {
  const { pdf, pageNumber, context } = params;
  const result = await recognizePageWords(pdf, pageNumber);
  if (!result) return null;
  return await invokeCommand<PdfCanonicalPage>("pdf_reflow_apply_ocr_page", {
    ...context,
    pageNumber,
    pageWidth: result.pageWidth,
    pageHeight: result.pageHeight,
    rotation: 0,
    words: result.words,
  }).catch(() => null);
}

/** Graphical fallback when OCR is unavailable or declined (task 7.5). */
export async function graphicalFallbackPage(params: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  context: PdfReflowCacheContext;
}): Promise<PdfCanonicalPage | null> {
  const { pdf, pageNumber, context } = params;
  const input = await collectPageAnalysisInput(pdf, pageNumber);
  if (!input.rasterPngBase64) return null;
  return await invokeCommand<PdfCanonicalPage>("pdf_reflow_build_graphical_fallback", {
    ...context,
    pageNumber,
    pageWidth: input.pageWidth,
    pageHeight: input.pageHeight,
    rotation: input.rotation,
    rasterPngBase64: input.rasterPngBase64,
    rasterScale: input.rasterScale,
  }).catch(() => null);
}
