import type { PdfSourceAnchorState } from "../../types/readerPosition";
import type { PdfCanonicalBlock, PdfCanonicalPage, PdfCanonicalWord } from "../../types/pdfCanonical";
import type { PdfReflowBlock, PdfReflowDocument } from "./pdfReflowTypes";

export function anchorFromReflowBlock(block: PdfReflowBlock, fingerprint?: string | null, intraBlockOffset = 0): PdfSourceAnchorState {
  return {
    fingerprint,
    pageNumber: block.source.pageNumber,
    blockId: block.id,
    textQuote: block.text.slice(0, 180),
    rect: block.source.rects[0],
    intraBlockOffset,
    mappingConfidence: block.source.confidence,
  };
}

/** Canonical-block anchor: word-level when known, block-level otherwise. */
export function anchorFromCanonicalBlock(
  block: PdfCanonicalBlock,
  fingerprint?: string | null,
  wordId?: string,
): PdfSourceAnchorState {
  const region = block.sourceRegions[0]?.bbox;
  return {
    fingerprint,
    pageNumber: block.pageNumber,
    blockId: block.id,
    wordId,
    textQuote: block.text.slice(0, 180) || undefined,
    rect: region
      ? { x: region.x0, y: region.y0, width: region.x1 - region.x0, height: region.y1 - region.y0 }
      : undefined,
    mappingConfidence: block.confidence,
  };
}

/**
 * Resolve an anchor against canonical pages using the D9 order:
 * wordId → blockId → textQuote → best rect overlap. Returns the block plus
 * the resolved word (when word-level resolution succeeded).
 */
export function resolveCanonicalAnchor(
  pages: Array<PdfCanonicalPage | undefined> | Map<number, PdfCanonicalPage>,
  anchor: PdfSourceAnchorState,
): { block: PdfCanonicalBlock; word: PdfCanonicalWord | null } | null {
  const getPage = (pageNumber: number): PdfCanonicalPage | undefined =>
    pages instanceof Map ? pages.get(pageNumber) : pages[pageNumber - 1];
  const page = getPage(anchor.pageNumber);
  if (!page) return null;
  if (anchor.wordId) {
    const word = page.words.find((candidate) => candidate.id === anchor.wordId);
    if (word) {
      const block = page.blocks.find((candidate) => candidate.wordIds.includes(word.id));
      if (block) return { block, word };
    }
  }
  if (anchor.blockId) {
    const exact = page.blocks.find((candidate) => candidate.id === anchor.blockId);
    if (exact) return { block: exact, word: null };
  }
  const quote = anchor.textQuote?.trim().toLowerCase();
  if (quote) {
    const quoted = page.blocks.find(
      (candidate) =>
        candidate.text.toLowerCase().includes(quote) || quote.includes(candidate.text.toLowerCase()),
    );
    if (quoted) return { block: quoted, word: null };
  }
  if (anchor.rect) {
    const a = anchor.rect;
    let best: { block: PdfCanonicalBlock; score: number } | null = null;
    for (const block of page.blocks) {
      for (const region of block.sourceRegions) {
        const b = region.bbox;
        const left = Math.max(a.x, b.x0);
        const bottom = Math.max(a.y, b.y0);
        const right = Math.min(a.x + a.width, b.x1);
        const top = Math.min(a.y + a.height, b.y1);
        const intersection = Math.max(0, right - left) * Math.max(0, top - bottom);
        const score =
          intersection /
          Math.max(1, Math.min(a.width * a.height, (b.x1 - b.x0) * (b.y1 - b.y0)));
        if (!best || score > best.score) best = { block, score };
      }
    }
    if (best && best.score > 0) return { block: best.block, word: null };
  }
  return null;
}

function overlapScore(anchor: PdfSourceAnchorState, block: PdfReflowBlock): number {
  if (!anchor.rect || block.source.rects.length === 0) return 0;
  const a = anchor.rect;
  return Math.max(...block.source.rects.map((b) => {
    const left = Math.max(a.x, b.x);
    const bottom = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const top = Math.min(a.y + a.height, b.y + b.height);
    const intersection = Math.max(0, right - left) * Math.max(0, top - bottom);
    return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  }));
}

export function resolveReflowBlock(document: PdfReflowDocument, anchor: PdfSourceAnchorState): PdfReflowBlock | null {
  const page = document.pages[anchor.pageNumber];
  if (!page) return null;
  if (anchor.blockId) {
    const exact = page.blocks.find((block) => block.id === anchor.blockId);
    if (exact) return exact;
  }
  const quote = anchor.textQuote?.trim().toLowerCase();
  if (quote) {
    const quoted = page.blocks.find((block) => block.text.toLowerCase().includes(quote) || quote.includes(block.text.toLowerCase()));
    if (quoted) return quoted;
  }
  return [...page.blocks]
    .filter((block) => block.kind !== "page-break")
    .sort((a, b) => overlapScore(anchor, b) - overlapScore(anchor, a))[0] ?? null;
}

