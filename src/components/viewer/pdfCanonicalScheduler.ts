/**
 * Canonical (v2) reflow scheduler: native-cache-first reads, then
 * collect → Rust analyze → write-through, in outward-from-reader priority
 * order with idle yielding and generation-based cancellation (design D10).
 * One page analyzes at a time; the Rust side bounds concurrency too.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";
import { analyzePdfReflowPage } from "../../api/pdfReflow";
import type { PdfCanonicalPage } from "../../types/pdfCanonical";
import { PDF_CANONICAL_ENGINE_VERSION, PDF_CANONICAL_SCHEMA_VERSION } from "../../types/pdfCanonical";
import { collectPageAnalysisInput } from "./pdfCanonicalCollector";
import type { PdfCanonicalPageCache } from "./pdfCanonicalCache";
import { pdfPagePriorityOrder } from "./pdfReflowScheduler";

export { pdfPagePriorityOrder };

/** Join a line's word texts (words resolved from the page model). */
export function lineText(page: PdfCanonicalPage, line: { wordIds: string[] }): string {
  const byId = new Map(page.words.map((word) => [word.id, word]));
  return line.wordIds
    .map((id) => byId.get(id)?.text ?? "")
    .filter(Boolean)
    .join(" ");
}

export class PdfCanonicalScheduler {
  private generation = 0;
  private stopped = false;
  /** Analyzed pages by number — the marginal-recurrence evidence source. */
  private readonly analyzed = new Map<number, PdfCanonicalPage>();

  constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly cache: PdfCanonicalPageCache,
    private readonly onPage: (page: PdfCanonicalPage) => void,
  ) {}

  /**
   * Top/bottom line texts of already-analyzed neighbor pages (±1..3) —
   * header/footer recurrence evidence for the analyzer (task 5.3).
   */
  private marginalContext(pageNumber: number): string[] {
    const texts: string[] = [];
    for (let offset = -3; offset <= 3; offset += 1) {
      if (offset === 0) continue;
      const page = this.analyzed.get(pageNumber + offset);
      if (!page || page.lines.length === 0) continue;
      const byY = [...page.lines].sort((a, b) => b.baselineY - a.baselineY);
      texts.push(lineText(page, byY[0]), lineText(page, byY[byY.length - 1]));
    }
    return texts;
  }

  async start(currentPage: number, readyPages: Set<number>, maxDistance?: number): Promise<void> {
    const generation = ++this.generation;
    this.stopped = false;
    for (const pageNumber of pdfPagePriorityOrder(this.pdf.numPages, currentPage, maxDistance)) {
      if (this.stopped || generation !== this.generation) break;
      if (readyPages.has(pageNumber)) continue;
      try {
        // Cache-first: reopen reads previously analyzed pages for free.
        const cached = await this.cache.getPage(pageNumber);
        if (cached && cached.state === "ready") {
          if (this.stopped || generation !== this.generation) break;
          this.analyzed.set(pageNumber, cached);
          this.onPage(cached);
          continue;
        }
        const input = await collectPageAnalysisInput(this.pdf, pageNumber);
        if (this.stopped || generation !== this.generation) break;
        const page = await analyzePdfReflowPage({
          ...input,
          marginalContext: this.marginalContext(pageNumber),
        });
        if (this.stopped || generation !== this.generation) break;
        this.analyzed.set(pageNumber, page);
        await this.cache.putPage(page);
        this.onPage(page);
      } catch (error) {
        console.warn(`[PDF reflow] Canonical analysis failed for page ${pageNumber}`, error);
        // Failed analyses are never cached — the page renders in Original
        // view and retries on the next scheduler run.
        this.onPage(failedPage(pageNumber));
      }
      await new Promise<void>((resolve) => {
        if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 50 });
        else setTimeout(resolve, 0);
      });
    }
  }

  cancel(): void {
    this.stopped = true;
    this.generation += 1;
  }
}

function failedPage(pageNumber: number): PdfCanonicalPage {
  return {
    pageNumber,
    width: 0,
    height: 0,
    rotation: 0,
    state: "failed",
    classification: "fixed-layout-recommended",
    confidence: 0,
    textCoverage: 0,
    words: [],
    lines: [],
    blocks: [],
    warnings: ["analysis-failed"],
    errorCategory: "analysis_failed",
    schemaVersion: PDF_CANONICAL_SCHEMA_VERSION,
    engineVersion: PDF_CANONICAL_ENGINE_VERSION,
  };
}
