import type { SelectionContext } from "../../types/selection";

export type VimPositionAffinity = "forward" | "backward";

export interface QuoteFallback {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface EpubDocumentPosition {
  kind: "epub";
  spineIndex: number;
  cfi: string;
  textOffset: number;
  affinity: VimPositionAffinity;
  quote?: QuoteFallback;
}

export interface PdfDocumentPosition {
  kind: "pdf";
  pageNumber: number;
  itemIndex: number;
  charOffset: number;
  affinity: VimPositionAffinity;
  quote?: QuoteFallback;
}

export type DocumentPosition = EpubDocumentPosition | PdfDocumentPosition;

export interface DocumentRange {
  anchor: DocumentPosition;
  head: DocumentPosition;
  start: DocumentPosition;
  end: DocumentPosition;
  direction: "forward" | "backward";
}

export interface DocumentVimCapabilities {
  textNavigation: boolean;
  visualSelection: boolean;
  crossBoundarySelection: boolean;
  exactSourceRange: boolean;
  reasonUnavailable?: string;
}

export interface VimActionSnapshot {
  readonly documentId: string;
  readonly text: string;
  readonly range: DocumentRange;
  readonly selectionContext: SelectionContext;
  readonly createdAt: number;
}

export function compareDocumentPositions(a: DocumentPosition, b: DocumentPosition): number {
  if (a.kind !== b.kind) {
    throw new Error(`Cannot compare ${a.kind} and ${b.kind} document positions`);
  }
  if (a.kind === "epub" && b.kind === "epub") {
    return compareNumbers(a.spineIndex, b.spineIndex) ||
      compareStrings(a.cfi, b.cfi) || compareNumbers(a.textOffset, b.textOffset);
  }
  if (a.kind === "pdf" && b.kind === "pdf") {
    return compareNumbers(a.pageNumber, b.pageNumber) ||
      compareNumbers(a.itemIndex, b.itemIndex) || compareNumbers(a.charOffset, b.charOffset);
  }
  return 0;
}

export function orderDocumentRange(anchor: DocumentPosition, head: DocumentPosition): DocumentRange {
  const direction = compareDocumentPositions(anchor, head) <= 0 ? "forward" : "backward";
  return {
    anchor: cloneDocumentPosition(anchor),
    head: cloneDocumentPosition(head),
    start: cloneDocumentPosition(direction === "forward" ? anchor : head),
    end: cloneDocumentPosition(direction === "forward" ? head : anchor),
    direction,
  };
}

export function serializeDocumentPosition(position: DocumentPosition): string {
  return JSON.stringify(position);
}

export function deserializeDocumentPosition(value: string): DocumentPosition | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isDocumentPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function cloneDocumentPosition(position: DocumentPosition): DocumentPosition {
  return { ...position, quote: position.quote ? { ...position.quote } : undefined };
}

export function freezeActionSnapshot(snapshot: VimActionSnapshot): VimActionSnapshot {
  const range = orderDocumentRange(snapshot.range.anchor, snapshot.range.head);
  Object.freeze(range.anchor.quote);
  Object.freeze(range.head.quote);
  Object.freeze(range.start.quote);
  Object.freeze(range.end.quote);
  Object.freeze(range.anchor);
  Object.freeze(range.head);
  Object.freeze(range.start);
  Object.freeze(range.end);
  Object.freeze(range);
  return Object.freeze({ ...snapshot, range });
}

function isDocumentPosition(value: unknown): value is DocumentPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (p.affinity !== "forward" && p.affinity !== "backward") return false;
  if (p.kind === "epub") {
    return Number.isInteger(p.spineIndex) && typeof p.cfi === "string" &&
      Number.isInteger(p.textOffset) && (p.textOffset as number) >= 0;
  }
  if (p.kind === "pdf") {
    return Number.isInteger(p.pageNumber) && (p.pageNumber as number) >= 1 &&
      Number.isInteger(p.itemIndex) && (p.itemIndex as number) >= 0 &&
      Number.isInteger(p.charOffset) && (p.charOffset as number) >= 0;
  }
  return false;
}

function compareNumbers(a: number, b: number): number { return a === b ? 0 : a < b ? -1 : 1; }
function compareStrings(a: string, b: string): number { return a === b ? 0 : a < b ? -1 : 1; }
