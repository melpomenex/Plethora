/**
 * Reflow-mode canonical selection (task 4.3): DOM range → `data-w` word
 * spans → canonical word-ID range, resolved locally against the in-memory
 * page models. Single-page selections anchor word-exactly; anything else
 * falls back to the caller's legacy handling.
 */
import type { PdfCanonicalPage, PdfCanonicalWord } from "../../types/pdfCanonical";
import type { PdfCanonicalSelectionAnchor, PdfSelectionContext } from "../../types/selection";

export interface ReflowSelectionResult {
  text: string;
  context: PdfSelectionContext;
}

function pageNumberFromWordId(wordId: string): number | null {
  const match = /^p(\d+):w\d+$/.exec(wordId);
  return match ? Number(match[1]) : null;
}

/** Union per line of the covered words' boxes (canonical space). */
function lineRegionsForWords(
  page: PdfCanonicalPage,
  wordIds: Set<string>,
): PdfCanonicalSelectionAnchor["pageRegions"] {
  const wordById = new Map(page.words.map((word) => [word.id, word]));
  const regions: Array<{ order: number; region: PdfCanonicalSelectionAnchor["pageRegions"][number] }> = [];
  for (const line of page.lines) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let any = false;
    for (const id of line.wordIds) {
      if (!wordIds.has(id)) continue;
      const word = wordById.get(id);
      if (!word) continue;
      any = true;
      x0 = Math.min(x0, word.sourceBbox.x0);
      y0 = Math.min(y0, word.sourceBbox.y0);
      x1 = Math.max(x1, word.sourceBbox.x1);
      y1 = Math.max(y1, word.sourceBbox.y1);
    }
    if (any) {
      regions.push({
        order: line.readingOrder,
        region: { pageNumber: page.pageNumber, bbox: { x0, y0, x1, y1 } },
      });
    }
  }
  return regions.sort((a, b) => a.order - b.order).map((entry) => entry.region);
}

function legacyRectsFromRegions(regions: PdfCanonicalSelectionAnchor["pageRegions"]) {
  return regions.map((region) => ({
    x1: region.bbox.x0,
    y1: region.bbox.y0,
    x2: region.bbox.x1,
    y2: region.bbox.y1,
  }));
}

function cjkJoin(words: PdfCanonicalWord[]): string {
  const isCjk = (c: string) =>
    /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\u3040-\u30FF]/.test(c);
  let out = "";
  words.forEach((word, index) => {
    if (index === 0) {
      out += word.text;
      return;
    }
    const prev = words[index - 1].text.at(-1) ?? "";
    const curr = word.text.at(0) ?? "";
    if (!(isCjk(prev) && isCjk(curr))) out += " ";
    out += word.text;
  });
  return out;
}

/**
 * Resolve a DOM selection inside the reflow view. `root` scopes the
 * `[data-w]` span scan (the scroll container).
 */
export function canonicalReflowSelectionFromRange(
  selection: Selection,
  root: HTMLElement,
  pages: Map<number, PdfCanonicalPage>,
  documentId: string,
  fingerprint?: string | null,
): ReflowSelectionResult | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const spans = Array.from(root.querySelectorAll<HTMLElement>("[data-w]")).filter((span) => {
    try {
      return range.intersectsNode(span);
    } catch {
      return false;
    }
  });
  if (spans.length === 0) return null;
  const wordIds = spans.map((span) => span.dataset.w!).filter(Boolean);

  const pageNumbers = new Set(wordIds.map(pageNumberFromWordId).filter((n): n is number => n !== null));
  if (pageNumbers.size !== 1) return null; // multi-page reflow anchoring: phase 8
  const pageNumber = pageNumbers.values().next().value!;
  const page = pages.get(pageNumber);
  if (!page) return null;

  const covered = new Set(wordIds);
  const ordered = [...page.words]
    .filter((word) => covered.has(word.id))
    .sort((a, b) => a.readingOrder - b.readingOrder);
  if (ordered.length === 0) return null;
  const start = ordered[0];
  const end = ordered[ordered.length - 1];
  const text = cjkJoin(ordered);
  const regions = lineRegionsForWords(page, covered);
  const anchor: PdfCanonicalSelectionAnchor = {
    version: 2,
    startWordId: start.id,
    endWordId: end.id,
    wordIds: ordered.map((word) => word.id),
    blockIds: page.blocks.filter((block) => block.wordIds.some((id) => covered.has(id))).map((block) => block.id),
    pageRegions: regions,
    text,
  };
  return {
    text,
    context: {
      type: "pdf",
      documentId,
      fingerprint,
      source: "native",
      pages: [
        {
          pageNumber,
          viewportRects: [],
          pdfRects: legacyRectsFromRegions(regions),
        },
      ],
      canonical: anchor,
    },
  };
}
