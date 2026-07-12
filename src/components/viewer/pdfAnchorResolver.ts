import type { PdfSourceAnchorState } from "../../types/readerPosition";
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

