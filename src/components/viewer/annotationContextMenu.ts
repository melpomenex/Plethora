import type { SelectionContext } from "../../types/selection";
import type { AnchoredTextHighlight } from "../../utils/textHighlights";

/** A saved record's identity, independent of a renderer's page/range IDs. */
export interface SavedAnnotationTarget {
  extractId: string;
  documentId: string;
  text: string;
  color?: string | null;
}

export interface ReaderContextMenuPayload {
  x: number;
  y: number;
  selectedText: string;
  selectionContext?: SelectionContext | null;
  annotations?: SavedAnnotationTarget[];
}

export interface PersistedEpubHighlight {
  id: string;
  cfiRange: string;
  color?: string | null;
  text: string;
  annotation?: SavedAnnotationTarget;
}

export function rectContainsPoint(rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">, x: number, y: number): boolean {
  return rect.right > rect.left && rect.bottom > rect.top
    && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function uniqueAnnotationTargets(targets: SavedAnnotationTarget[]): SavedAnnotationTarget[] {
  return [...new Map(targets.map((target) => [`${target.documentId}\n${target.extractId}`, target])).values()];
}

/** Geometry works for pointer-transparent overlays and across iframe realms. */
export function renderedAnnotationTargetsAtPoint(
  root: HTMLElement,
  descriptors: Array<{ id: string; annotation?: SavedAnnotationTarget; wordIds?: string[] }>,
  x: number,
  y: number,
): SavedAnnotationTarget[] {
  const byId = new Map(descriptors.map((entry) => [entry.id, entry.annotation]));
  const hits: SavedAnnotationTarget[] = [];
  for (const mark of root.querySelectorAll<HTMLElement>("[data-highlight-id]")) {
    if (![...mark.getClientRects()].some((rect) => rectContainsPoint(rect, x, y))) continue;
    let ids = [mark.dataset.highlightId ?? ""];
    try {
      const parsed: unknown = JSON.parse(mark.dataset.highlightIds ?? "null");
      if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === "string");
    } catch { /* Imported markup may contain unrelated data attributes. */ }
    for (const id of ids) {
      const target = byId.get(id);
      if (target) hits.push(target);
    }
  }
  // Canonical PDF reflow uses stable word IDs rather than fixed-page rects.
  for (const word of root.querySelectorAll<HTMLElement>("[data-w].pdf-reflow-highlight")) {
    if (![...word.getClientRects()].some((rect) => rectContainsPoint(rect, x, y))) continue;
    for (const descriptor of descriptors) {
      if (descriptor.annotation && descriptor.wordIds?.includes(word.dataset.w ?? "")) hits.push(descriptor.annotation);
    }
  }
  return uniqueAnnotationTargets(hits);
}

export function textAnnotationTargetsAtPoint(root: HTMLElement, highlights: AnchoredTextHighlight[], x: number, y: number): SavedAnnotationTarget[] {
  return renderedAnnotationTargetsAtPoint(root, highlights, x, y);
}

/** EPUB ranges live in the contents document; their rects use frame-local coordinates. */
export function epubAnnotationTargetsAtPoint(
  highlights: PersistedEpubHighlight[],
  getRange: (cfi: string) => Range | null,
  contentDocument: Document,
  x: number,
  y: number,
): SavedAnnotationTarget[] {
  const hits: SavedAnnotationTarget[] = [];
  for (const highlight of highlights) {
    if (!highlight.annotation) continue;
    try {
      const range = getRange(highlight.cfiRange);
      if (range?.startContainer.ownerDocument !== contentDocument) continue;
      if ([...range.getClientRects()].some((rect) => rectContainsPoint(rect, x, y))) hits.push(highlight.annotation);
    } catch {
      // Unmounted spine sections have no live range to hit.
    }
  }
  return uniqueAnnotationTargets(hits);
}
