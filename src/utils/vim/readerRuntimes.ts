import type { PdfSelectionPage } from "../../types/selection";

export interface EpubVimSectionRuntime {
  spineIndex: number;
  href: string;
  load(signal?: AbortSignal): Promise<Document>;
  cfiForElement(element: Element, edge: "start" | "end"): string;
  cfiForTextOffset(element: Element, offset: number, edge: "start" | "end"): string;
  cfiForRange(startOffset: number, endOffset: number): Promise<string>;
}

export interface EpubVimRuntime {
  documentId: string;
  sections: EpubVimSectionRuntime[];
  currentSpineIndex(): number;
  currentCfi(): string | null;
  currentWindow(): Window | null;
  reveal(cfi: string, signal?: AbortSignal): Promise<void>;
  rangeFromCfi(cfi: string): Range | null;
  cfiFromRange(range: Range): string;
  subscribe(listener: (event: { kind: "content" | "geometry" | "destroyed"; spineIndex?: number }) => void): () => void;
}

export interface PdfVimRuntime {
  documentId: string;
  pageCount: number;
  currentPageNumber(): number;
  loadPageText(pageNumber: number, signal?: AbortSignal): Promise<Array<{
    str: string;
    transform?: readonly number[];
    width?: number;
    height?: number;
    hasEOL?: boolean;
  }>>;
  revealPage(pageNumber: number, signal?: AbortSignal): Promise<void>;
  textLayer(pageNumber: number): HTMLElement | null;
  pageSelectionContext(pageNumber: number, range: Range): PdfSelectionPage | null;
  subscribe(listener: (event: { kind: "content" | "geometry" | "destroyed"; pageNumber?: number }) => void): () => void;
}
