/**
 * Canonical PDF content model — TypeScript mirror of
 * `src-tauri/src/pdf/model.rs` (schema v2, engine `rust-hybrid-v2`).
 *
 * Field names must match the Rust serde output exactly (camelCase); parity is
 * enforced against a shared golden fixture by
 * `src/types/__tests__/pdfCanonical.test.ts` and the Rust model tests.
 */

export const PDF_CANONICAL_SCHEMA_VERSION = 2;
export const PDF_CANONICAL_ENGINE_VERSION = "rust-hybrid-v2";

/** Where a word's text came from; born-digital text stays "native-pdf-text". */
export type PdfWordSource = "native-pdf-text" | "ocr" | "graphical";

export interface PdfFontInfo {
  /** Font size in PDF user-space points. */
  size: number;
  bold: boolean;
  italic: boolean;
  /** Raw pdf.js font name (internal identifier, not a display name). */
  family: string | null;
}

/** Axis-aligned rectangle in PDF user space (origin bottom-left, y up). */
export interface PdfRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfCanonicalWord {
  /** `p{page}:w{index}` — deterministic for a fixed engine version. */
  id: string;
  /** 1-based page number. */
  pageNumber: number;
  text: string;
  sourceBbox: PdfRect;
  /** Additional bboxes when a word was assembled from disjoint pieces. */
  sourceFragments: PdfRect[];
  /** False when the bbox was interpolated along a pdf.js text item. */
  bboxExact: boolean;
  readingOrder: number;
  confidence: number;
  source: PdfWordSource;
  dehyphenated: boolean;
  font: PdfFontInfo | null;
}

export interface PdfCanonicalLine {
  /** `p{page}:l{index}`. */
  id: string;
  wordIds: string[];
  bbox: PdfRect;
  /** Baseline y in PDF user space. */
  baselineY: number;
  readingOrder: number;
}

export type PdfCanonicalBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "figure"
  | "caption"
  | "footnote"
  | "equation"
  | "code"
  | "quote"
  | "sidebar"
  | "horizontal-rule"
  | "page-break"
  | "unknown-visual";

/** Marginal roles are suppressed in reflow rendering only, never deleted. */
export type PdfCanonicalRole = "body" | "header" | "footer" | "page-number";

export type PdfCanonicalDirection = "ltr" | "rtl" | "auto";

export interface PdfSourceRegion {
  /** 1-based page number. */
  pageNumber: number;
  bbox: PdfRect;
}

export interface PdfTableData {
  rows: string[][];
  headerRow: number | null;
  ruled: boolean;
}

export interface PdfCanonicalBlock {
  /** `p{page}:b{index}` — index in deterministic analysis output order. */
  id: string;
  kind: PdfCanonicalBlockKind;
  role: PdfCanonicalRole;
  pageNumber: number;
  sourceRegions: PdfSourceRegion[];
  wordIds: string[];
  lineIds: string[];
  readingOrder: number;
  confidence: number;
  /** Exact canonical text ("" for purely visual blocks). */
  text: string;
  direction: PdfCanonicalDirection;
  language: string | null;
  /** List items (`kind === "list"`). */
  items: string[] | null;
  table: PdfTableData | null;
  /** Cached source-crop asset id (figure/equation/low-confidence crops). */
  assetId: string | null;
  /** Textual fallback for visual blocks (search/TTS/AI, never flowing text). */
  altText: string | null;
  /** Caption blocks link to the figure they describe. */
  captionOf: string | null;
  href: string | null;
  extraction: PdfWordSource;
}

export type PdfCanonicalPageState =
  | "pending"
  | "processing"
  | "ready"
  | "ocr-required"
  | "failed";

export type PdfCanonicalClassification =
  | "semantic"
  | "semantic-with-warnings"
  | "ocr-required"
  | "fixed-layout-recommended";

export interface PdfCanonicalPage {
  /** 1-based page number. */
  pageNumber: number;
  /** PDF user-space page dimensions in points (before rotation). */
  width: number;
  height: number;
  /** 0/90/180/270 viewport rotation of the analysis raster. */
  rotation: number;
  state: PdfCanonicalPageState;
  classification: PdfCanonicalClassification;
  confidence: number;
  /** Fraction of ink-covered content accounted for by native text. */
  textCoverage: number;
  words: PdfCanonicalWord[];
  lines: PdfCanonicalLine[];
  blocks: PdfCanonicalBlock[];
  warnings: string[];
  errorCategory: string | null;
  schemaVersion: number;
  engineVersion: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parse a cached canonical page with schema/engine guards (miss → null). */
export function parsePdfCanonicalPage(raw: string): PdfCanonicalPage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== PDF_CANONICAL_SCHEMA_VERSION) return null;
  if (value.engineVersion !== PDF_CANONICAL_ENGINE_VERSION) return null;
  if (typeof value.pageNumber !== "number" || !Array.isArray(value.blocks)) return null;
  return value as PdfCanonicalPage;
}
