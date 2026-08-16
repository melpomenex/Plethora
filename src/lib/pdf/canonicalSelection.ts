/**
 * Canonical selection facade (design D8): resolves PDF selections against
 * the Rust canonical model and attaches the v2 anchor to selection
 * contexts. Callers fall back to legacy text-layer behavior whenever the
 * page is unanalyzed or resolution misses — enrichment never fails a
 * selection.
 */
import { getPdfDocumentSourceInfo } from "../../api/documents";
import {
  resolvePdfReflowSelection,
  type PdfReflowCacheContext,
} from "../../api/pdfReflow";
import {
  PDF_CANONICAL_ENGINE_VERSION,
  PDF_CANONICAL_SCHEMA_VERSION,
} from "../../types/pdfCanonical";
import type { PdfCanonicalSelectionAnchor, PdfRect, PdfSelectionContext } from "../../types/selection";

export interface ResolvedCanonicalSelection {
  startWordId: string;
  endWordId: string;
  wordIds: string[];
  text: string;
  pageRegions: Array<{
    pageNumber: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

const sourceInfoCache = new Map<string, PdfReflowCacheContext>();

async function documentContext(documentId: string): Promise<PdfReflowCacheContext | null> {
  const cached = sourceInfoCache.get(documentId);
  if (cached) return cached;
  try {
    const info = await getPdfDocumentSourceInfo(documentId);
    const context: PdfReflowCacheContext = {
      documentId,
      sourceIdentity: info.identity,
      schemaVersion: PDF_CANONICAL_SCHEMA_VERSION,
      engineVersion: PDF_CANONICAL_ENGINE_VERSION,
    };
    sourceInfoCache.set(documentId, context);
    return context;
  } catch {
    return null;
  }
}

/** Resolve selection rects (legacy x1/y1/x2/y2 space) against a cached page. */
export async function resolveCanonicalSelection(
  documentId: string,
  pageNumber: number,
  rects: PdfRect[],
): Promise<ResolvedCanonicalSelection | null> {
  const context = await documentContext(documentId);
  if (!context || rects.length === 0) return null;
  return await resolvePdfReflowSelection(
    context,
    pageNumber,
    rects.map((rect) => [rect.x1, rect.y1, rect.x2, rect.y2]),
  );
}

/**
 * Attach the canonical v2 anchor to a selection context when its (single)
 * page has been analyzed. Multi-page canonical anchoring arrives with the
 * full reflow wiring; those selections keep legacy geometry meanwhile.
 */
export async function enrichPdfSelectionWithCanonical(
  context: PdfSelectionContext,
): Promise<PdfSelectionContext> {
  if (context.pages.length !== 1) return context;
  const page = context.pages[0];
  try {
    const resolved = await resolveCanonicalSelection(
      context.documentId,
      page.pageNumber,
      page.pdfRects,
    );
    if (!resolved) return context;
    const anchor: PdfCanonicalSelectionAnchor = {
      version: 2,
      startWordId: resolved.startWordId,
      endWordId: resolved.endWordId,
      wordIds: resolved.wordIds,
      blockIds: [],
      pageRegions: resolved.pageRegions,
      text: resolved.text,
    };
    return { ...context, canonical: anchor };
  } catch {
    return context;
  }
}

/** test-only: clear the identity cache between suites. */
export function clearCanonicalSelectionCaches(): void {
  sourceInfoCache.clear();
}
