import type { Extract } from "../../api/extracts";
import type { PdfMarkup, PdfRect, PdfSelectionContext, PdfTextMarkupKind } from "../../types/selection";
import { legacyFromCanonicalRect } from "./coordinates";

export const PDF_TEXT_MARKUP = ["highlight", "underline", "strikethrough", "note"] as const;
export const PDF_REGION_MARKUP = ["rectangle", "ellipse", "ink", "freeText", "stamp"] as const;
export const PDF_MARKUP_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;

export interface PdfAnnotationPatch {
  documentId: string;
  id: string;
  expectedModifiedAt: string;
  kind?: PdfTextMarkupKind;
  note?: string;
  color?: typeof PDF_MARKUP_COLORS[number];
  removed?: boolean;
}

export interface PdfAnnotation {
  id: string;
  documentId: string;
  content: string;
  note?: string;
  color?: string;
  createdAt: string;
  modifiedAt: string;
  context: PdfSelectionContext;
  markup: PdfMarkup;
  pages: { pageNumber: number; pdfRects: PdfRect[] }[];
}

export function isPdfTextMarkup(kind: string): kind is PdfTextMarkupKind {
  return PDF_TEXT_MARKUP.some((candidate) => candidate === kind);
}

export function pdfAnnotationFromExtract(extract: Extract, documentId: string): PdfAnnotation | null {
  const context = extract.selection_context;
  if (extract.document_id !== documentId || context?.type !== "pdf" || !Array.isArray(context.pages)) return null;
  if (context.documentId && context.documentId !== documentId) return null;
  const candidates = new Map<number, PdfRect[]>();
  if (Array.isArray(context.canonical?.pageRegions) && context.canonical.pageRegions.length) {
    for (const { pageNumber, bbox } of context.canonical.pageRegions) {
      const rects = candidates.get(pageNumber) ?? [];
      rects.push(legacyFromCanonicalRect(bbox));
      candidates.set(pageNumber, rects);
    }
  } else {
    for (const page of context.pages) {
      if (!Array.isArray(page.pdfRects)) continue;
      candidates.set(page.pageNumber, [...(candidates.get(page.pageNumber) ?? []), ...page.pdfRects]);
    }
  }
  const pages = [...candidates]
    .filter(([page]) => Number.isSafeInteger(page) && page > 0)
    .map(([pageNumber, pdfRects]) => ({ pageNumber, pdfRects: pdfRects.filter(
      (rect) => rect && [rect.x1, rect.y1, rect.x2, rect.y2].every(Number.isFinite),
    ) }))
    .filter((page) => page.pdfRects.length > 0)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  if (pages.length === 0) return null;
  return {
    id: extract.id,
    documentId,
    content: extract.content,
    note: extract.notes,
    color: extract.highlight_color,
    createdAt: extract.date_created,
    modifiedAt: extract.date_modified,
    context,
    markup: context.pdfMarkup?.version === 1 ? context.pdfMarkup : { version: 1, kind: "highlight" },
    pages,
  };
}

export function patchPdfAnnotation(extract: Extract, patch: PdfAnnotationPatch):
  Partial<Pick<Extract, "notes" | "highlight_color">> & { selection_context: PdfSelectionContext } {
  const annotation = pdfAnnotationFromExtract(extract, patch.documentId);
  if (!annotation || annotation.modifiedAt !== patch.expectedModifiedAt) {
    throw new Error("The annotation changed. Reopen it and try again.");
  }
  if (patch.kind !== undefined && (!isPdfTextMarkup(annotation.markup.kind) || !isPdfTextMarkup(patch.kind))) {
    throw new Error("This annotation type cannot be changed.");
  }
  if (patch.color !== undefined && !PDF_MARKUP_COLORS.includes(patch.color)) {
    throw new Error("Unknown PDF annotation color.");
  }
  return {
    selection_context: {
      ...annotation.context,
      pdfMarkup: {
        ...annotation.markup,
        ...(patch.kind === undefined ? {} : { kind: patch.kind }),
        ...(patch.removed === undefined ? {} : { removed: patch.removed }),
      },
    },
    ...(patch.note === undefined ? {} : { notes: patch.note }),
    ...(patch.color === undefined ? {} : { highlight_color: patch.color }),
  };
}
