import type { SelectionContext } from "../../types/selection";
import type {
  DocumentPosition,
  DocumentRange,
  DocumentVimCapabilities,
  VimActionSnapshot,
} from "./documentModel";

export type DocumentVimMotion =
  | "left" | "right" | "word-forward" | "word-backward" | "word-end"
  | "line-up" | "line-down" | "line-start" | "line-end"
  | "paragraph-backward" | "paragraph-forward" | "document-start" | "document-end";

export type DocumentVimInvalidation =
  | { kind: "geometry" }
  | { kind: "content"; region?: string | number }
  | { kind: "destroyed" };

export interface DocumentPositionGeometry {
  rect: DOMRectReadOnly;
  mounted: boolean;
  surfaceId: string;
}

export interface DocumentMotionRequest {
  motion: DocumentVimMotion;
  count: number;
  desiredX: number | null;
  signal?: AbortSignal;
}
export interface DocumentMoveResult { position: DocumentPosition; desiredX: number | null; }

export interface DocumentRangeContent {
  text: string;
  selectionContext: SelectionContext;
}

export interface DocumentVimAdapter {
  readonly documentId: string;
  capabilities(): Promise<DocumentVimCapabilities>;
  initialPosition(): Promise<DocumentPosition | null>;
  resolvePosition(position: DocumentPosition): Promise<DocumentPosition | null>;
  compare(a: DocumentPosition, b: DocumentPosition): number;
  move(from: DocumentPosition, request: DocumentMotionRequest): Promise<DocumentMoveResult>;
  reveal(position: DocumentPosition, signal?: AbortSignal): Promise<void>;
  geometry(position: DocumentPosition): Promise<DocumentPositionGeometry | null>;
  positionFromPoint(x: number, y: number): Promise<DocumentPosition | null>;
  rangeContent(range: DocumentRange): Promise<DocumentRangeContent>;
  lineRange(position: DocumentPosition): Promise<DocumentRange>;
  renderRange(range: DocumentRange | null): Promise<void>;
  snapshot(range: DocumentRange): Promise<VimActionSnapshot>;
  invalidate(event: DocumentVimInvalidation): void;
  subscribeInvalidation(listener: (event: DocumentVimInvalidation) => void): () => void;
  dispose(): void;
}

export function isSelectionContextForPosition(
  context: SelectionContext,
  position: DocumentPosition,
): boolean {
  return context.type === position.kind;
}
