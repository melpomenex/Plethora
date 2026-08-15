/**
 * Canonical PDF page cache (v2) — native-first with a per-session memory
 * warm layer (design D10).
 *
 * Unlike the v1 prototype cache (`pdfReflowCache.ts`, whose native writes
 * were never read back), reads go to the Rust cache first; the memory layer
 * only avoids repeat IPC for pages already fetched or produced this session.
 * Analysis results are written through to Rust so they survive reload.
 */
import {
  getPdfReflowPage,
  putPdfReflowPage,
  type PdfReflowCacheContext,
} from "../../api/pdfReflow";
import { isTauri } from "../../lib/tauri";
import type { PdfCanonicalPage } from "../../types/pdfCanonical";

export interface PdfCanonicalPageCache {
  getPage(pageNumber: number): Promise<PdfCanonicalPage | null>;
  putPage(page: PdfCanonicalPage): Promise<void>;
  /** Drop the memory layer (document switch); native cache is untouched. */
  reset(): void;
}

export class PdfCanonicalPageCacheImpl implements PdfCanonicalPageCache {
  private readonly memory = new Map<number, PdfCanonicalPage>();
  private readonly native: boolean;

  constructor(private readonly context: PdfReflowCacheContext) {
    this.native = isTauri();
  }

  async getPage(pageNumber: number): Promise<PdfCanonicalPage | null> {
    const cached = this.memory.get(pageNumber);
    if (cached) return cached;
    if (!this.native) return null;
    const page = await getPdfReflowPage(this.context, pageNumber);
    if (page) this.memory.set(pageNumber, page);
    return page;
  }

  async putPage(page: PdfCanonicalPage): Promise<void> {
    this.memory.set(page.pageNumber, page);
    if (!this.native) return;
    await putPdfReflowPage(this.context, page).catch((error) => {
      console.warn("[PDF reflow] Native cache write failed", error);
    });
  }

  reset(): void {
    this.memory.clear();
  }
}

export function createPdfCanonicalPageCache(
  context: PdfReflowCacheContext,
): PdfCanonicalPageCache {
  return new PdfCanonicalPageCacheImpl(context);
}
