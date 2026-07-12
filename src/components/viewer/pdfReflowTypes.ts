import type { PdfAnalysisClassification } from "./pdfDiagnostics";

export const PDF_REFLOW_SCHEMA_VERSION = 1;
export const PDF_REFLOW_ENGINE_VERSION = "pdfjs-geometry-v1";

export type PdfReflowBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "figure"
  | "caption"
  | "footnote"
  | "equation"
  | "code"
  | "page-break";
export type PdfReflowExtractionMethod = "pdf-text" | "ocr";
export type PdfReflowDirection = "ltr" | "rtl" | "auto";
export type PdfReflowProcessingState = "pending" | "processing" | "ready" | "ocr-required" | "failed";

export interface PdfSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfSourceToken {
  id: string;
  text: string;
  rect: PdfSourceRect;
}

export interface PdfSourceAnchor {
  pageNumber: number;
  rects: PdfSourceRect[];
  tokenIds: string[];
  confidence: number;
}

export interface PdfReflowBlock {
  id: string;
  kind: PdfReflowBlockKind;
  text: string;
  source: PdfSourceAnchor;
  extractionMethod: PdfReflowExtractionMethod;
  confidence: number;
  direction: PdfReflowDirection;
  language?: string;
  items?: string[];
  table?: string[][];
  href?: string;
}

export interface PdfReflowPage {
  pageNumber: number;
  width: number;
  height: number;
  state: PdfReflowProcessingState;
  classification: PdfAnalysisClassification;
  confidence: number;
  textCoverage: number;
  blocks: PdfReflowBlock[];
  warnings: string[];
  errorCategory?: string;
}

export interface PdfReflowDocument {
  schemaVersion: number;
  engineVersion: string;
  documentId: string;
  sourceIdentity: string;
  fingerprint: string;
  pageCount: number;
  classification: PdfAnalysisClassification;
  confidence: number;
  direction: PdfReflowDirection;
  language?: string;
  pages: Record<number, PdfReflowPage>;
  updatedAt: number;
}

export function createPdfReflowDocument(options: {
  documentId: string;
  sourceIdentity: string;
  fingerprint: string;
  pageCount: number;
  direction?: PdfReflowDirection;
  language?: string;
}): PdfReflowDocument {
  return {
    schemaVersion: PDF_REFLOW_SCHEMA_VERSION,
    engineVersion: PDF_REFLOW_ENGINE_VERSION,
    documentId: options.documentId,
    sourceIdentity: options.sourceIdentity,
    fingerprint: options.fingerprint,
    pageCount: options.pageCount,
    classification: "semantic-with-warnings",
    confidence: 0,
    direction: options.direction ?? "auto",
    language: options.language,
    pages: {},
    updatedAt: Date.now(),
  };
}

export function serializePdfReflowDocument(document: PdfReflowDocument): string {
  return JSON.stringify(document);
}

export function parsePdfReflowDocument(raw: string): PdfReflowDocument | null {
  try {
    const value = JSON.parse(raw) as Partial<PdfReflowDocument> | null;
    if (!value || typeof value !== "object") return null;
    if (value.schemaVersion !== PDF_REFLOW_SCHEMA_VERSION) return null;
    if (value.engineVersion !== PDF_REFLOW_ENGINE_VERSION) return null;
    if (typeof value.documentId !== "string" || typeof value.sourceIdentity !== "string") return null;
    if (typeof value.fingerprint !== "string" || typeof value.pageCount !== "number") return null;
    if (!value.pages || typeof value.pages !== "object") return null;
    return value as PdfReflowDocument;
  } catch {
    return null;
  }
}

export function pdfReflowCacheKey(document: Pick<PdfReflowDocument, "documentId" | "sourceIdentity" | "schemaVersion" | "engineVersion">): string {
  return [document.documentId, document.sourceIdentity, document.schemaVersion, document.engineVersion].join(":");
}

