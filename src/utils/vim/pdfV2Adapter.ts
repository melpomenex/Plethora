import type { PdfSelectionContext, PdfSelectionPage } from "../../types/selection";
import type { DocumentMotionRequest, DocumentPositionGeometry, DocumentRangeContent, DocumentVimAdapter, DocumentVimInvalidation } from "./documentAdapter";
import { compareDocumentPositions, freezeActionSnapshot, orderDocumentRange, type DocumentPosition, type DocumentRange, type DocumentVimCapabilities, type PdfDocumentPosition, type VimActionSnapshot } from "./documentModel";
import { movePdfPosition } from "./formatNavigation";
import { PdfLogicalIndex } from "./pdfLogicalIndex";
import type { PdfVimRuntime } from "./readerRuntimes";
import { VimRangeOverlay } from "./rangeOverlay";

export class PdfV2Adapter implements DocumentVimAdapter {
  readonly documentId: string;
  private readonly index: PdfLogicalIndex;
  private readonly listeners = new Set<(event: DocumentVimInvalidation) => void>();
  private readonly unsubscribe: () => void;
  private readonly overlay = new VimRangeOverlay();

  constructor(private readonly runtime: PdfVimRuntime) {
    this.documentId = runtime.documentId;
    this.index = new PdfLogicalIndex(runtime.loadPageText);
    this.unsubscribe = runtime.subscribe((runtimeEvent) => {
      const event: DocumentVimInvalidation = runtimeEvent.kind === "destroyed"
        ? { kind: "destroyed" }
        : runtimeEvent.kind === "content"
          ? { kind: "content", region: runtimeEvent.pageNumber }
          : { kind: "geometry" };
      if (runtimeEvent.kind === "content") this.index.invalidate(runtimeEvent.pageNumber);
      this.listeners.forEach((listener) => listener(event));
    });
  }
  async capabilities(): Promise<DocumentVimCapabilities> {
    const page = await this.index.page(this.runtime.currentPageNumber());
    const available = page.tokens.length > 0;
    return { textNavigation: available, visualSelection: available, crossBoundarySelection: true, exactSourceRange: available, reasonUnavailable: available ? undefined : "This page has no spatially mapped text" };
  }
  async initialPosition(): Promise<DocumentPosition | null> {
    const pageNumber = this.runtime.currentPageNumber();
    const page = await this.index.page(pageNumber);
    const token = page.tokens[0];
    return token ? { kind: "pdf", pageNumber, itemIndex: token.index, charOffset: token.startOffset, affinity: "forward", quote: { exact: token.text } } : null;
  }
  async resolvePosition(position: DocumentPosition): Promise<DocumentPosition | null> {
    if (position.kind !== "pdf" || position.pageNumber > this.runtime.pageCount) return null;
    const page = await this.index.page(position.pageNumber);
    const exact = position.quote?.exact;
    let offset = exact ? page.text.indexOf(exact, Math.max(0, position.charOffset - 80)) : -1;
    if (offset < 0 && exact) offset = page.text.indexOf(exact);
    const token = offset >= 0
      ? page.tokens.find((candidate) => offset >= candidate.startOffset && offset <= candidate.endOffset)
      : page.tokens[position.itemIndex] ?? page.tokens.find((candidate) => candidate.startOffset >= position.charOffset);
    return token ? { ...position, itemIndex: token.index, charOffset: token.startOffset, quote: { ...position.quote!, exact: token.text } } : null;
  }
  compare(a: DocumentPosition, b: DocumentPosition): number { return compareDocumentPositions(a, b); }
  async move(from: DocumentPosition, request: DocumentMotionRequest) {
    if (from.kind !== "pdf") throw new Error("PDF adapter received a non-PDF position");
    const moved = await movePdfPosition(this.index, from, request, this.runtime.pageCount);
    return { position: moved.position, desiredX: moved.desiredX };
  }
  async reveal(position: DocumentPosition, signal?: AbortSignal): Promise<void> { if (position.kind === "pdf") await this.runtime.revealPage(position.pageNumber, signal); }
  async geometry(position: DocumentPosition): Promise<DocumentPositionGeometry | null> {
    if (position.kind !== "pdf") return null;
    const tokenRange = this.domRangeForPageSlice(position.pageNumber, position.charOffset, position.charOffset + Math.max(1, position.quote?.exact.length ?? 1));
    const rect = tokenRange?.getBoundingClientRect();
    return rect ? { rect, mounted: true, surfaceId: `pdf-${position.pageNumber}` } : null;
  }
  async positionFromPoint(x: number, y: number): Promise<DocumentPosition | null> {
    const range = document.caretRangeFromPoint?.(x, y);
    const root = range?.startContainer.parentElement?.closest<HTMLElement>(".textLayer");
    if (!range || !root) return null;
    const pageNumber = this.findPageNumber(root);
    if (!pageNumber) return null;
    const nodes = textNodes(root);
    const page = await this.index.page(pageNumber);
    const charOffset = offsetForDomPoint(nodes, range.startContainer as Text, range.startOffset);
    const token = page.tokens.find((candidate) => charOffset >= candidate.startOffset && charOffset <= candidate.endOffset) ?? page.tokens[0];
    return token ? { kind: "pdf", pageNumber, itemIndex: token.index, charOffset, affinity: "forward", quote: { exact: token.text } } : null;
  }
  async rangeContent(range: DocumentRange): Promise<DocumentRangeContent> {
    const start = range.start as PdfDocumentPosition;
    const end = range.end as PdfDocumentPosition;
    const textParts: string[] = [];
    const pages: PdfSelectionPage[] = [];
    for (let pageNumber = start.pageNumber; pageNumber <= end.pageNumber; pageNumber += 1) {
      const page = await this.index.page(pageNumber);
      const from = pageNumber === start.pageNumber ? start.charOffset : 0;
      const to = pageNumber === end.pageNumber ? end.charOffset + (end.quote?.exact.length ?? 0) : page.text.length;
      textParts.push(page.text.slice(from, Math.max(from, to)));
      const domRange = this.domRangeForPageSlice(pageNumber, from, to);
      const context = domRange ? this.runtime.pageSelectionContext(pageNumber, domRange) : null;
      pages.push(context ?? logicalPdfPageContext(pageNumber, page.textItems, from, to));
    }
    const text = textParts.join("\n").trim();
    const selectionContext: PdfSelectionContext = { type: "pdf", documentId: this.documentId, source: "native", pages };
    return { text, selectionContext };
  }
  async lineRange(position: DocumentPosition): Promise<DocumentRange> {
    if (position.kind !== "pdf") throw new Error("PDF line range requires a PDF position");
    const page = await this.index.page(position.pageNumber);
    const token = page.tokens[position.itemIndex] ?? page.tokens.find((candidate) => position.charOffset >= candidate.startOffset && position.charOffset <= candidate.endOffset);
    const block = page.blocks.find((candidate) => candidate.tokens.some((item) => item.index === token?.index));
    const first = block?.tokens[0]; const last = block?.tokens.at(-1);
    if (!first || !last) return orderDocumentRange(position, position);
    return orderDocumentRange(
      { ...position, itemIndex: first.index, charOffset: first.startOffset, quote: { exact: first.text } },
      { ...position, itemIndex: last.index, charOffset: last.startOffset, quote: { exact: last.text } },
    );
  }
  async renderRange(range: DocumentRange | null): Promise<void> {
    const selection = document.getSelection();
    selection?.removeAllRanges();
    this.overlay.clear();
    if (!range || range.start.kind !== "pdf" || range.end.kind !== "pdf") return;
    const rects: DOMRect[] = [];
    let firstMounted = Number.POSITIVE_INFINITY; let lastMounted = 0;
    for (let pageNumber = range.start.pageNumber; pageNumber <= range.end.pageNumber; pageNumber += 1) {
      const page = await this.index.page(pageNumber);
      const from = pageNumber === range.start.pageNumber ? range.start.charOffset : 0;
      const to = pageNumber === range.end.pageNumber ? range.end.charOffset + (range.end.quote?.exact.length ?? 0) : page.text.length;
      const domRange = this.domRangeForPageSlice(pageNumber, from, to);
      if (!domRange) continue;
      firstMounted = Math.min(firstMounted, pageNumber); lastMounted = Math.max(lastMounted, pageNumber);
      rects.push(...Array.from(domRange.getClientRects()));
      if (range.start.pageNumber === range.end.pageNumber) selection?.addRange(domRange);
    }
    this.overlay.render(rects, { before: firstMounted > range.start.pageNumber, after: lastMounted < range.end.pageNumber });
  }
  async snapshot(range: DocumentRange): Promise<VimActionSnapshot> {
    const ordered = orderDocumentRange(range.anchor, range.head);
    const content = await this.rangeContent(ordered);
    return freezeActionSnapshot({ documentId: this.documentId, text: content.text, range: ordered, selectionContext: content.selectionContext, createdAt: Date.now() });
  }
  invalidate(event: DocumentVimInvalidation): void { if (event.kind === "content") this.index.invalidate(typeof event.region === "number" ? event.region : undefined); this.listeners.forEach((listener) => listener(event)); }
  subscribeInvalidation(listener: (event: DocumentVimInvalidation) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { this.unsubscribe(); this.listeners.clear(); this.index.invalidate(); this.overlay.dispose(); }

  private domRangeForPageSlice(pageNumber: number, start: number, end: number): Range | null {
    const root = this.runtime.textLayer(pageNumber);
    if (!root) return null;
    const nodes = textNodes(root);
    const startPoint = pointAtOffset(nodes, start);
    const endPoint = pointAtOffset(nodes, end);
    if (!startPoint || !endPoint) return null;
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
  }
  private findPageNumber(root: HTMLElement): number | null {
    for (let page = 1; page <= this.runtime.pageCount; page += 1) if (this.runtime.textLayer(page) === root) return page;
    return null;
  }
}

function textNodes(root: HTMLElement): Text[] {
  return Array.from(root.querySelectorAll("span:not(.endOfContent)"))
    .map((span) => span.firstChild)
    .filter((node): node is Text => node instanceof Text && Boolean(node.textContent));
}
function pointAtOffset(nodes: Text[], offset: number): { node: Text; offset: number } | null {
  let remaining = Math.max(0, offset);
  for (const node of nodes) {
    const length = node.data.length;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  const last = nodes.at(-1);
  return last ? { node: last, offset: last.data.length } : null;
}
function offsetForDomPoint(nodes: Text[], target: Text, localOffset: number): number {
  let offset = 0;
  for (const node of nodes) {
    if (node === target) return offset + localOffset;
    offset += node.data.length;
  }
  return offset;
}
function logicalPdfPageContext(pageNumber: number, items: readonly { str?: string; transform?: readonly number[]; width?: number; height?: number }[], startOffset: number, endOffset: number): PdfSelectionPage {
  let offset = 0;
  const pdfRects = items.flatMap((item) => {
    const itemStart = offset; const itemEnd = itemStart + (item.str?.length ?? 0); offset = itemEnd;
    if (itemEnd < startOffset || itemStart > endOffset) return [];
    const transform = item.transform;
    if (!transform || transform.length < 6) return [];
    const x = transform[4]; const y = transform[5]; const width = item.width ?? 0; const height = item.height ?? Math.abs(transform[3] ?? 0);
    return [{ x1: x, y1: y, x2: x + width, y2: y + height }];
  });
  return { pageNumber, viewportRects: [], pdfRects };
}
