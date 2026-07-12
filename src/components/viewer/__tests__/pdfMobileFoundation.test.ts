import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPdfFeatureEnabled, PDF_FEATURE_KEYS, shouldUseNativeMobilePdfSource } from "../pdfFeatureFlags";
import { normalizePdfError, pdfErrorUserMessage, shouldRetryPdfWorker } from "../pdfErrors";
import { PdfDiagnostics, pdfSizeBucket } from "../pdfDiagnostics";

describe("mobile PDF feature flags", () => {
  beforeEach(() => localStorage.clear());

  it("enables the native source and keeps semantic reflow independent", () => {
    expect(isPdfFeatureEnabled("nativeMobileRangeSource")).toBe(true);
    expect(isPdfFeatureEnabled("semanticReflow")).toBe(false);
    localStorage.setItem(PDF_FEATURE_KEYS.nativeMobileRangeSource, "false");
    localStorage.setItem(PDF_FEATURE_KEYS.semanticReflow, "true");
    expect(isPdfFeatureEnabled("nativeMobileRangeSource")).toBe(false);
    expect(isPdfFeatureEnabled("semanticReflow")).toBe(true);
  });

  it("selects native ranges only for native-mobile PDFs", () => {
    expect(shouldUseNativeMobilePdfSource({ nativeMobile: true, fileType: "pdf" })).toBe(true);
    expect(shouldUseNativeMobilePdfSource({ nativeMobile: false, fileType: "pdf" })).toBe(false);
    expect(shouldUseNativeMobilePdfSource({ nativeMobile: true, fileType: "epub" })).toBe(false);
  });
});

describe("PDF error normalization", () => {
  it("preserves typed native errors", () => {
    const error = normalizePdfError({
      code: "pdf_source_changed",
      message: "changed",
      recoverable: true,
    });
    expect(error.category).toBe("source_changed");
    expect(error.recoverable).toBe(true);
    expect(pdfErrorUserMessage(error)).toContain("changed");
    expect(shouldRetryPdfWorker(error)).toBe(false);
  });

  it("reserves worker retry for non-source failures", () => {
    expect(shouldRetryPdfWorker(normalizePdfError(new Error("Worker bootstrap failed")))).toBe(true);
  });

  it("turns raw fetch failures into actionable source failures", () => {
    expect(normalizePdfError(new TypeError("Failed to fetch")).category).toBe("source_unavailable");
  });
});

describe("privacy-safe PDF diagnostics", () => {
  it("buckets sizes and records only operational values", () => {
    expect(pdfSizeBucket(70 * 1024 ** 2)).toBe("64-256mb");
    const diagnostics = new PdfDiagnostics("native-range", 70 * 1024 ** 2);
    diagnostics.recordRange(4096);
    diagnostics.update({ errorCategory: "source_changed" });
    const safe = diagnostics.toSafeText();
    expect(safe).toContain("native-range");
    expect(safe).toContain("4096");
    expect(safe).not.toContain("filename");
    expect(JSON.parse(safe)).toMatchObject({ rangeRequests: 1, rangeBytes: 4096 });
  });
});
