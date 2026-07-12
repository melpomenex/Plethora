import { describe, expect, it } from "vitest";
import { initialPdfReaderState, reducePdfReaderState } from "../pdfReaderState";
import { normalizePdfError, pdfRecoveryActionsFor } from "../pdfErrors";

describe("PDF reader state machine", () => {
  it("covers opening, password retry, analysis, partial reflow, OCR, and ready states", () => {
    let state = reducePdfReaderState(initialPdfReaderState, { type: "OPEN" });
    expect(state.phase).toBe("opening");
    state = reducePdfReaderState(state, { type: "REQUEST_PASSWORD", incorrect: false });
    expect(state).toMatchObject({ phase: "password-required", incorrectPassword: false });
    state = reducePdfReaderState(state, { type: "REQUEST_PASSWORD", incorrect: true });
    expect(state.incorrectPassword).toBe(true);
    state = reducePdfReaderState(state, { type: "ANALYZE" });
    expect(state.phase).toBe("analyzing");
    state = reducePdfReaderState(state, { type: "PARTIAL_REFLOW" });
    expect(state.phase).toBe("partially-reflowed");
    state = reducePdfReaderState(state, { type: "START_OCR" });
    expect(state.phase).toBe("ocr-processing");
    state = reducePdfReaderState(state, { type: "READY" });
    expect(state.phase).toBe("readable");
  });

  it("distinguishes recoverable and terminal failures", () => {
    const missing = normalizePdfError({ code: "pdf_source_missing", message: "missing", recoverable: true });
    expect(reducePdfReaderState(initialPdfReaderState, { type: "FAIL", error: missing }).phase).toBe("recoverable-error");
    expect(pdfRecoveryActionsFor(missing, { hasSyncedFile: true })).toEqual(["retry", "download", "copy-diagnostics"]);

    const corrupt = normalizePdfError(new Error("Invalid PDF: corrupt"));
    expect(reducePdfReaderState(initialPdfReaderState, { type: "FAIL", error: corrupt }).phase).toBe("terminal-error");
    expect(pdfRecoveryActionsFor(corrupt)).toEqual(["copy-diagnostics"]);
    expect(pdfRecoveryActionsFor(corrupt, { hasLocalFile: true })).toEqual(["open-original", "copy-diagnostics"]);
  });
});
