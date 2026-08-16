import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfReflowCache } from "./pdfReflowCache";
import { extractPdfReflowPage } from "./pdfReflowAnalyzer";
import type { PdfReflowDocument, PdfReflowPage } from "./pdfReflowTypes";

/**
 * Analysis order: outward from the reader position, alternating forward and
 * backward by distance. `maxDistance` bounds the run to a lazy window around
 * the current page (design D10) — without it a long book analyzed every page
 * in the background for hours, starving the UI; page changes restart the
 * scheduler with a fresh window, and analyzed pages are cache-hits.
 */
export function pdfPagePriorityOrder(pageCount: number, currentPage: number, maxDistance?: number): number[] {
  const pages: number[] = [];
  for (let distance = 0; pages.length < pageCount; distance += 1) {
    if (maxDistance !== undefined && distance > maxDistance) break;
    const forward = currentPage + distance;
    const backward = currentPage - distance;
    if (forward >= 1 && forward <= pageCount && !pages.includes(forward)) pages.push(forward);
    if (backward >= 1 && backward <= pageCount && !pages.includes(backward)) pages.push(backward);
  }
  return pages;
}

export class PdfReflowScheduler {
  private generation = 0;
  private stopped = false;

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private document: PdfReflowDocument,
    private readonly cache: PdfReflowCache,
    private readonly onPage: (page: PdfReflowPage, document: PdfReflowDocument) => void,
  ) {}

  async start(currentPage: number, maxDistance?: number): Promise<PdfReflowDocument> {
    const generation = ++this.generation;
    this.stopped = false;
    for (const pageNumber of pdfPagePriorityOrder(this.pdf.numPages, currentPage, maxDistance)) {
      if (this.stopped || generation !== this.generation) break;
      if (this.document.pages[pageNumber]?.state === "ready") continue;
      try {
        const proxy = await this.pdf.getPage(pageNumber);
        if (this.stopped || generation !== this.generation) break;
        const page = await extractPdfReflowPage(proxy, pageNumber);
        if (this.stopped || generation !== this.generation) break;
        this.document = await this.cache.putPage(this.document, page);
        this.onPage(page, this.document);
      } catch {
        const failed: PdfReflowPage = {
          pageNumber,
          width: 0,
          height: 0,
          state: "failed",
          classification: "fixed-layout-recommended",
          confidence: 0,
          textCoverage: 0,
          blocks: [],
          warnings: ["analysis-failed"],
          errorCategory: "analysis_failed",
        };
        this.document = await this.cache.putPage(this.document, failed);
        this.onPage(failed, this.document);
      }
      await new Promise<void>((resolve) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 50 });
        else setTimeout(resolve, 0);
      });
    }
    return this.document;
  }

  cancel(): void {
    this.stopped = true;
    this.generation += 1;
  }
}

