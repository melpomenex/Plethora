import type { NormalizedPdfError } from "./pdfErrors";

export type PdfReaderPhase =
  | "source-resolution"
  | "opening"
  | "password-required"
  | "analyzing"
  | "readable"
  | "partially-reflowed"
  | "ocr-processing"
  | "recoverable-error"
  | "terminal-error";

export interface PdfReaderState {
  phase: PdfReaderPhase;
  error?: NormalizedPdfError;
  incorrectPassword?: boolean;
}

export type PdfReaderAction =
  | { type: "RESOLVE_SOURCE" }
  | { type: "OPEN" }
  | { type: "REQUEST_PASSWORD"; incorrect: boolean }
  | { type: "ANALYZE" }
  | { type: "READY" }
  | { type: "PARTIAL_REFLOW" }
  | { type: "START_OCR" }
  | { type: "FAIL"; error: NormalizedPdfError };

export const initialPdfReaderState: PdfReaderState = { phase: "source-resolution" };

export function reducePdfReaderState(_state: PdfReaderState, action: PdfReaderAction): PdfReaderState {
  switch (action.type) {
    case "RESOLVE_SOURCE": return { phase: "source-resolution" };
    case "OPEN": return { phase: "opening" };
    case "REQUEST_PASSWORD": return { phase: "password-required", incorrectPassword: action.incorrect };
    case "ANALYZE": return { phase: "analyzing" };
    case "READY": return { phase: "readable" };
    case "PARTIAL_REFLOW": return { phase: "partially-reflowed" };
    case "START_OCR": return { phase: "ocr-processing" };
    case "FAIL": return {
      phase: action.error.recoverable ? "recoverable-error" : "terminal-error",
      error: action.error,
    };
  }
}

