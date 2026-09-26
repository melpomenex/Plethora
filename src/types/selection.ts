export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfSelectionPage {
  pageNumber: number;
  viewportRects: ViewportRect[];
  pdfRects: PdfRect[];
}

/**
 * Token data for custom selection engine.
 * Used to store precise token identifiers for selection ranges.
 */
export interface PdfSelectionTokenData {
  startTokenId: string;
  endTokenId: string;
  tokenIds: string[];
}

/**
 * Canonical model anchoring (selection_context v2, additive): exact word-ID
 * range resolved by the Rust canonical model. When present, downstream
 * consumers (highlight painting, extract provenance, view-source navigation)
 * prefer this over legacy `pdfRects` geometry; legacy payloads without it
 * keep rendering unchanged.
 */
export interface PdfCanonicalSelectionAnchor {
  version: 2;
  startWordId: string;
  endWordId: string;
  wordIds: string[];
  blockIds: string[];
  /** Canonical-space regions (x0/y0/x1/y1, PDF user space, y up). */
  pageRegions: Array<{
    pageNumber: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  /** Exact canonical text of the word range. */
  text: string;
}

export interface PdfSelectionContext {
  type: "pdf";
  documentId: string;
  fingerprint?: string | null;
  /** Selection source: 'native' uses DOM Selection API, 'custom' uses geometric selection */
  source?: "native" | "custom";
  pages: PdfSelectionPage[];
  /** Token identifiers for custom selection engine (only when source='custom') */
  tokenData?: PdfSelectionTokenData;
  /** Semantic-reflow anchors; geometry remains the source of truth when present. */
  reflowBlockIds?: string[];
  mappingConfidence?: number;
  /** Canonical word-ID anchoring (v2); takes precedence when present. */
  canonical?: PdfCanonicalSelectionAnchor;
}

export interface EpubSelectionContext {
  type: "epub";
  documentId: string;
  cfiRange: string;
  /** One exact range per covered spine item for cross-section Vim selections. */
  cfiRanges?: string[];
  selectedText: string;
}

export type TextSelectionSurface = "html" | "markdown" | "extract" | "x-thread";

/**
 * Durable, re-locatable anchor for text-surface selections (html/markdown).
 * Character offsets alone are invalidated whenever the rendered content is
 * regenerated (re-import, image-settings changes); the text quote plus
 * surrounding context survives those, and the container selector scopes
 * quote resolution. Persisted additively on `TextSelectionContext`.
 */
export interface WebSelectionAnchor {
  /** Exact selected text plus bounded surrounding context for relocation. */
  textQuote: {
    exact: string;
    prefix: string;
    suffix: string;
  };
  /** Stable container path within the reader root (hint only, may be absent). */
  selector?: string;
  /** Nearest preceding section heading text, when one exists. */
  sectionHeading?: string;
}

/** X thread post provenance attached to selections/extracts from the native
 *  thread viewer (surface "x-thread"): stable anchors back to the post. */
export interface XThreadPostProvenance {
  rootId: string;
  rootUrl: string;
  postId: string;
  postIndex: number;
  author: string; // @handle
}

export interface TextSelectionContext {
  type: "text";
  surface: TextSelectionSurface;
  documentId: string;
  extractId?: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  /** X thread post provenance (surface "x-thread"). */
  xThread?: XThreadPostProvenance;
  /** Durable quote anchor (html/markdown); offsets stay the fast path. */
  anchor?: WebSelectionAnchor;
}

export type SelectionContext = PdfSelectionContext | EpubSelectionContext | TextSelectionContext;
