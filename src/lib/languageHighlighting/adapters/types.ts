import type { ReaderSurface, ReaderTokenAnchor, VisibleRange } from "../types";

/** Reader hosts own mounting, scrolling, selection, and lifecycle. Adapters are read-only. */
export interface LanguageHighlightReaderAdapter {
  readonly surface: ReaderSurface;
  readonly sourceId: string;
  getTokenAnchors(): readonly ReaderTokenAnchor[];
  getVisibleRange(): VisibleRange;
  dispose(): void;
}

export interface DomAdapterRoot {
  nodeType: number;
  ownerDocument: Document | null;
}
