/**
 * PDF text and outline extraction utility using pdfjs-dist.
 * Provides on-demand full document extraction with page mapping and outline
 * resolution for audio edition generation, reader indexing, and assistant context.
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { readDocumentFile } from "../api/documents";

export interface PdfOutlineItem {
  title: string;
  pageNumber: number;
  level: number;
  items?: PdfOutlineItem[];
}

export interface PdfPageContent {
  pageNumber: number;
  text: string;
}

export interface PdfExtractedData {
  outline: PdfOutlineItem[];
  pageContents: PdfPageContent[];
  fullText: string;
  totalPages: number;
  totalChars: number;
}

export interface ExtractPdfDataOptions {
  onProgress?: (current: number, total: number) => void;
  maxPages?: number;
  isCancelled?: () => boolean;
}

async function resolveOutlinePages(
  pdfDoc: PDFDocumentProxy,
  items: any[],
  level = 1
): Promise<PdfOutlineItem[]> {
  const result: PdfOutlineItem[] = [];
  for (const item of items) {
    let pageNumber = 1;
    let dest = item.dest;
    if (typeof dest === "string") {
      try {
        dest = await pdfDoc.getDestination(dest);
      } catch {
        // Ignore destination lookup error
      }
    }
    if (Array.isArray(dest) && dest[0]) {
      try {
        const pageIdx = await pdfDoc.getPageIndex(dest[0]);
        if (typeof pageIdx === "number" && !isNaN(pageIdx)) {
          pageNumber = pageIdx + 1;
        }
      } catch {
        // Ignore index lookup error
      }
    }
    const children =
      item.items && item.items.length > 0
        ? await resolveOutlinePages(pdfDoc, item.items, level + 1)
        : [];
    const cleanTitle = (item.title || "Untitled").replace(/[\r\n]+/g, " ").trim();
    result.push({
      title: cleanTitle,
      pageNumber,
      level,
      items: children.length > 0 ? children : undefined,
    });
  }
  return result;
}

/**
 * Extracts all text, per-page contents, and outline hierarchy from a PDF file.
 */
export async function extractPdfData(
  filePath: string,
  options?: ExtractPdfDataOptions
): Promise<PdfExtractedData> {
  if (!filePath) {
    return {
      outline: [],
      pageContents: [],
      fullText: "",
      totalPages: 0,
      totalChars: 0,
    };
  }

  const rawBytes = await readDocumentFile(filePath);
  if (!rawBytes || rawBytes.length === 0) {
    return {
      outline: [],
      pageContents: [],
      fullText: "",
      totalPages: 0,
      totalChars: 0,
    };
  }

  // Ensure independent buffer slice to prevent IPC/worker detachment issues
  const bytes = new Uint8Array(
    rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength)
  );

  let pdfDoc: PDFDocumentProxy | null = null;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      verbosity: 0,
    } as any);
    pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages || 0;

    let outline: PdfOutlineItem[] = [];
    try {
      const rawOutline = await pdfDoc.getOutline();
      if (rawOutline && rawOutline.length > 0) {
        outline = await resolveOutlinePages(pdfDoc, rawOutline);
      }
    } catch (err) {
      console.warn("[pdfTextExtractor] Failed to resolve PDF outline:", err);
    }

    const pageContents: PdfPageContent[] = [];
    const maxPages = options?.maxPages
      ? Math.min(totalPages, options.maxPages)
      : totalPages;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (options?.isCancelled?.()) {
        break;
      }
      try {
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (pageText) {
          pageContents.push({ pageNumber: pageNum, text: pageText });
        }
      } catch (err) {
        console.warn(`[pdfTextExtractor] Failed to extract page ${pageNum}:`, err);
      }
      options?.onProgress?.(pageNum, totalPages);
    }

    const fullText = pageContents.map((p) => p.text).join("\n\n");

    return {
      outline,
      pageContents,
      fullText,
      totalPages,
      totalChars: fullText.length,
    };
  } finally {
    try {
      await pdfDoc?.destroy?.();
    } catch {
      // Ignore destroy error
    }
  }
}
