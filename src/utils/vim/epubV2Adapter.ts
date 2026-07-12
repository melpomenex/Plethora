import type { EpubSelectionContext } from "../../types/selection";
import type { DocumentVimAdapter, DocumentMotionRequest, DocumentPositionGeometry, DocumentRangeContent, DocumentVimInvalidation } from "./documentAdapter";
import { compareDocumentPositions, freezeActionSnapshot, orderDocumentRange, type DocumentPosition, type DocumentRange, type DocumentVimCapabilities, type EpubDocumentPosition, type VimActionSnapshot } from "./documentModel";
import { EpubLogicalIndex } from "./epubLogicalIndex";
import { moveEpubPosition } from "./formatNavigation";
import type { EpubVimRuntime } from "./readerRuntimes";
import { VimRangeOverlay } from "./rangeOverlay";

export class EpubV2Adapter implements DocumentVimAdapter {
  readonly documentId: string;
  private readonly index: EpubLogicalIndex;
  private readonly listeners = new Set<(event: DocumentVimInvalidation) => void>();
  private readonly unsubscribe: () => void;
  private readonly overlay = new VimRangeOverlay();

  constructor(private readonly runtime: EpubVimRuntime) {
    this.documentId = runtime.documentId;
    this.index = new EpubLogicalIndex(runtime.sections.map((section) => ({
      spineIndex: section.spineIndex, href: section.href, load: section.load, cfiForElement: section.cfiForElement, cfiForTextOffset: section.cfiForTextOffset, cfiForRange: section.cfiForRange,
    })));
    this.unsubscribe = runtime.subscribe((runtimeEvent) => {
      const event: DocumentVimInvalidation = runtimeEvent.kind === "content" ? { kind: "content", region: runtimeEvent.spineIndex } : { kind: runtimeEvent.kind };
      if (runtimeEvent.kind === "content") this.index.invalidate(runtimeEvent.spineIndex);
      this.listeners.forEach((listener) => listener(event));
    });
  }

  async capabilities(): Promise<DocumentVimCapabilities> {
    const section = await this.index.section(this.runtime.currentSpineIndex());
    const available = Boolean(section?.tokens.length);
    return { textNavigation: available, visualSelection: available, crossBoundarySelection: true, exactSourceRange: true, reasonUnavailable: available ? undefined : "No navigable text in this section" };
  }
  async initialPosition(): Promise<DocumentPosition | null> {
    const spineIndex = this.runtime.currentSpineIndex();
    const section = await this.index.section(spineIndex);
    const currentCfi = this.runtime.currentCfi();
    const currentRange = currentCfi ? this.runtime.rangeFromCfi(currentCfi) : null;
    const currentQuote = currentRange?.startContainer.textContent?.slice(currentRange.startOffset, currentRange.startOffset + 48).trim();
    const currentOffset = currentQuote ? section?.text.indexOf(currentQuote) ?? -1 : -1;
    const token = currentOffset >= 0
      ? section?.tokens.find((candidate) => currentOffset >= candidate.startOffset && currentOffset <= candidate.endOffset)
      : section?.tokens[0];
    const cfi = currentCfi || (token ? section?.tokenCfis.get(token.index)?.startCfi : null) || section?.cfiBoundaries[0]?.startCfi;
    return token && cfi ? { kind: "epub", spineIndex, cfi, textOffset: token.startOffset, affinity: "forward", quote: { exact: token.text } } : null;
  }
  async resolvePosition(position: DocumentPosition): Promise<DocumentPosition | null> {
    if (position.kind !== "epub") return null;
    const direct = this.runtime.rangeFromCfi(position.cfi);
    if (direct) return position;
    const section = await this.index.section(position.spineIndex);
    if (!section) return null;
    const exact = position.quote?.exact;
    let offset = exact ? section.text.indexOf(exact, Math.max(0, position.textOffset - 80)) : -1;
    if (offset < 0 && exact) offset = section.text.indexOf(exact);
    const token = section.tokens.find((candidate) => offset >= candidate.startOffset && offset <= candidate.endOffset) ?? section.tokens.find((candidate) => candidate.startOffset >= position.textOffset);
    const block = section.blocks.find((candidate) => candidate.tokens.some((item) => item.index === token?.index));
    const cfi = section.cfiBoundaries.find((candidate) => candidate.blockIndex === block?.index)?.startCfi;
    return token && cfi ? { ...position, cfi, textOffset: token.startOffset, quote: { ...position.quote!, exact: token.text } } : null;
  }
  compare(a: DocumentPosition, b: DocumentPosition): number { return compareDocumentPositions(a, b); }
  async move(from: DocumentPosition, request: DocumentMotionRequest) {
    if (from.kind !== "epub") throw new Error("EPUB adapter received a non-EPUB position");
    const moved = await moveEpubPosition(this.index, from, request, 0, this.runtime.sections.length - 1);
    return { position: moved.position, desiredX: moved.desiredX };
  }
  async reveal(position: DocumentPosition, signal?: AbortSignal): Promise<void> {
    if (position.kind !== "epub") return;
    await this.runtime.reveal(position.cfi, signal);
  }
  async geometry(position: DocumentPosition): Promise<DocumentPositionGeometry | null> {
    if (position.kind !== "epub") return null;
    const range = this.runtime.rangeFromCfi(position.cfi);
    const rect = range?.getBoundingClientRect();
    return rect ? { rect, mounted: true, surfaceId: `epub-${position.spineIndex}` } : null;
  }
  async positionFromPoint(x: number, y: number): Promise<DocumentPosition | null> {
    const win = this.runtime.currentWindow();
    const doc = win?.document;
    const range = doc?.caretRangeFromPoint?.(x, y);
    if (!range) return null;
    const cfi = this.runtime.cfiFromRange(range);
    return { kind: "epub", spineIndex: this.runtime.currentSpineIndex(), cfi, textOffset: range.startOffset, affinity: "forward", quote: { exact: range.startContainer.textContent?.slice(range.startOffset, range.startOffset + 32) ?? "" } };
  }
  async rangeContent(range: DocumentRange): Promise<DocumentRangeContent> {
    const start = range.start as EpubDocumentPosition;
    const end = range.end as EpubDocumentPosition;
    const textParts: string[] = [];
    const cfiRanges: string[] = [];
    for (let spine = start.spineIndex; spine <= end.spineIndex; spine += 1) {
      const section = await this.index.section(spine);
      if (!section) continue;
      const from = spine === start.spineIndex ? start.textOffset : 0;
      const to = spine === end.spineIndex ? end.textOffset + (end.quote?.exact.length ?? 0) : section.text.length;
      textParts.push(section.text.slice(from, Math.max(from, to)));
      const exactRange = await this.index.cfiRange(spine, from, Math.max(from, to));
      if (exactRange) cfiRanges.push(exactRange);
    }
    const cfiRange = cfiRanges[0] ?? start.cfi;
    const text = textParts.join("\n").trim();
    const selectionContext: EpubSelectionContext = { type: "epub", documentId: this.documentId, cfiRange, cfiRanges, selectedText: text };
    return { text, selectionContext };
  }
  async lineRange(position: DocumentPosition): Promise<DocumentRange> {
    if (position.kind !== "epub") throw new Error("EPUB line range requires an EPUB position");
    const section = await this.index.section(position.spineIndex);
    const token = section?.tokens.find((candidate) => position.textOffset >= candidate.startOffset && position.textOffset <= candidate.endOffset);
    const block = section?.blocks.find((candidate) => candidate.tokens.some((item) => item.index === token?.index));
    const first = block?.tokens[0]; const last = block?.tokens.at(-1);
    if (!section || !first || !last) return orderDocumentRange(position, position);
    const firstCfi = section.tokenCfis.get(first.index)?.startCfi ?? position.cfi;
    const lastCfi = section.tokenCfis.get(last.index)?.startCfi ?? position.cfi;
    return orderDocumentRange(
      { ...position, cfi: firstCfi, textOffset: first.startOffset, quote: { exact: first.text } },
      { ...position, cfi: lastCfi, textOffset: last.startOffset, quote: { exact: last.text } },
    );
  }
  async renderRange(range: DocumentRange | null): Promise<void> {
    const selection = this.runtime.currentWindow()?.getSelection();
    selection?.removeAllRanges();
    this.overlay.clear();
    if (!range || range.start.kind !== "epub" || range.end.kind !== "epub") return;
    const start = this.runtime.rangeFromCfi(range.start.cfi);
    const end = this.runtime.rangeFromCfi(range.end.cfi);
    if (!start || !end || start.startContainer.ownerDocument !== end.startContainer.ownerDocument) {
      this.overlay.render([], { before: range.start.spineIndex < this.runtime.currentSpineIndex(), after: range.end.spineIndex > this.runtime.currentSpineIndex() });
      return;
    }
    const domRange = start.startContainer.ownerDocument!.createRange();
    domRange.setStart(start.startContainer, start.startOffset);
    domRange.setEnd(end.endContainer, end.endOffset);
    selection?.addRange(domRange);
    this.overlay.render(Array.from(domRange.getClientRects()), { before: false, after: false });
  }
  async snapshot(range: DocumentRange): Promise<VimActionSnapshot> {
    const content = await this.rangeContent(orderDocumentRange(range.anchor, range.head));
    return freezeActionSnapshot({ documentId: this.documentId, text: content.text, range, selectionContext: content.selectionContext, createdAt: Date.now() });
  }
  invalidate(event: DocumentVimInvalidation): void { if (event.kind === "content") this.index.invalidate(typeof event.region === "number" ? event.region : undefined); this.listeners.forEach((listener) => listener(event)); }
  subscribeInvalidation(listener: (event: DocumentVimInvalidation) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { this.unsubscribe(); this.listeners.clear(); this.index.invalidate(); this.overlay.dispose(); }
}
