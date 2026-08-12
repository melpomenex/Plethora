import type { PdfErrorCategory } from "./pdfErrors";

export type PdfSourceStrategy = "native-range" | "file-data" | "asset-url" | "web-url" | "none";
export type PdfAnalysisClassification = "semantic" | "semantic-with-warnings" | "ocr-required" | "fixed-layout-recommended";

export interface PdfDiagnosticsSnapshot {
  sourceStrategy: PdfSourceStrategy;
  sizeBucket: "unknown" | "under-1mb" | "1-16mb" | "16-64mb" | "64-256mb" | "over-256mb";
  rangeRequests: number;
  rangeBytes: number;
  timeToFirstPageMs?: number;
  timeToFirstReflowMs?: number;
  classification?: PdfAnalysisClassification;
  ocrState?: "idle" | "queued" | "processing" | "ready" | "failed" | "cancelled";
  errorCategory?: PdfErrorCategory;
  /**
   * Set when a whole-file load was used in a runtime where the range source
   * was expected (task 6.3): a silent regression to whole-file loading must be
   * observable in diagnostics and in the memory benchmark.
   */
  fallbackReason?: string;
}

export function pdfSizeBucket(bytes?: number | null): PdfDiagnosticsSnapshot["sizeBucket"] {
  if (typeof bytes !== "number" || bytes < 0) return "unknown";
  if (bytes < 1024 ** 2) return "under-1mb";
  if (bytes < 16 * 1024 ** 2) return "1-16mb";
  if (bytes < 64 * 1024 ** 2) return "16-64mb";
  if (bytes < 256 * 1024 ** 2) return "64-256mb";
  return "over-256mb";
}

export class PdfDiagnostics {
  private snapshot: PdfDiagnosticsSnapshot;

  constructor(sourceStrategy: PdfSourceStrategy = "none", size?: number | null) {
    this.snapshot = {
      sourceStrategy,
      sizeBucket: pdfSizeBucket(size),
      rangeRequests: 0,
      rangeBytes: 0,
    };
  }

  setSource(sourceStrategy: PdfSourceStrategy, size?: number | null): void {
    this.snapshot.sourceStrategy = sourceStrategy;
    this.snapshot.sizeBucket = pdfSizeBucket(size);
  }

  recordRange(bytes: number): void {
    this.snapshot.rangeRequests += 1;
    this.snapshot.rangeBytes += Math.max(0, bytes);
  }

  /**
   * Record that a whole-file load was used instead of the range source
   * (task 6.3). `reason` must be a stable machine-readable token.
   */
  recordFallback(reason: string): void {
    this.snapshot.fallbackReason = reason;
    this.snapshot.sourceStrategy = "file-data";
  }

  update(values: Partial<Omit<PdfDiagnosticsSnapshot, "sourceStrategy" | "sizeBucket" | "rangeRequests" | "rangeBytes">>): void {
    Object.assign(this.snapshot, values);
  }

  value(): PdfDiagnosticsSnapshot {
    return { ...this.snapshot };
  }

  // Intentionally contains no document ID, filename, path, text, URL, or page image.
  toSafeText(): string {
    return JSON.stringify(this.snapshot, null, 2);
  }
}

