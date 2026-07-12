export type PdfErrorCategory =
  | "source_missing"
  | "source_unauthorized"
  | "source_changed"
  | "source_invalid_range"
  | "source_too_large"
  | "source_unavailable"
  | "password_required"
  | "password_incorrect"
  | "pdf_corrupt"
  | "pdf_unsupported"
  | "analysis_failed"
  | "ocr_failed"
  | "cache_failed"
  | "resource_limit"
  | "cancelled"
  | "unknown";

export interface NormalizedPdfError {
  category: PdfErrorCategory;
  message: string;
  recoverable: boolean;
  cause?: unknown;
}

const CATEGORY_BY_NATIVE_CODE: Record<string, PdfErrorCategory> = {
  pdf_source_missing: "source_missing",
  pdf_source_unauthorized: "source_unauthorized",
  pdf_source_changed: "source_changed",
  pdf_invalid_range: "source_invalid_range",
  pdf_range_too_large: "source_too_large",
  pdf_not_pdf: "pdf_unsupported",
  pdf_source_unavailable: "source_unavailable",
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? "Unknown PDF error");
}

export function normalizePdfError(error: unknown): NormalizedPdfError {
  if (error && typeof error === "object" && "category" in error && "message" in error) {
    return error as NormalizedPdfError;
  }
  if (error && typeof error === "object" && "code" in error) {
    const native = error as { code?: unknown; message?: unknown; recoverable?: unknown };
    const code = String(native.code ?? "");
    const category = CATEGORY_BY_NATIVE_CODE[code] ?? "unknown";
    return {
      category,
      message: String(native.message ?? "The PDF source could not be read."),
      recoverable: typeof native.recoverable === "boolean" ? native.recoverable : true,
      cause: error,
    };
  }

  const message = errorText(error);
  const lower = message.toLowerCase();
  let category: PdfErrorCategory = "unknown";
  if (/password/.test(lower) && /(incorrect|invalid)/.test(lower)) category = "password_incorrect";
  else if (/password/.test(lower)) category = "password_required";
  else if (/(missing|not found|not synced)/.test(lower)) category = "source_missing";
  else if (/(permission|unauthori[sz]ed|denied)/.test(lower)) category = "source_unauthorized";
  else if (/(changed|stale|identity)/.test(lower)) category = "source_changed";
  else if (/(invalid pdf|corrupt|damaged)/.test(lower)) category = "pdf_corrupt";
  else if (/(unsupported|unknown format)/.test(lower)) category = "pdf_unsupported";
  else if (/(out of memory|allocation|resource limit)/.test(lower)) category = "resource_limit";
  else if (/(abort|cancel)/.test(lower)) category = "cancelled";
  else if (/failed to fetch/.test(lower)) category = "source_unavailable";

  return {
    category,
    message,
    recoverable: !["pdf_corrupt", "pdf_unsupported"].includes(category),
    cause: error,
  };
}

export function pdfErrorUserMessage(error: NormalizedPdfError): string {
  switch (error.category) {
    case "source_missing": return "This PDF is not available on this device yet.";
    case "source_unauthorized": return "Incrementum no longer has permission to read this PDF.";
    case "source_changed": return "This PDF changed while it was open. Reload it to continue.";
    case "password_required": return "This PDF is password protected.";
    case "password_incorrect": return "That password did not unlock the PDF.";
    case "pdf_corrupt": return "This PDF appears to be damaged and could not be opened.";
    case "pdf_unsupported": return "This PDF uses features that are not supported on this device.";
    case "resource_limit": return "This PDF needs more memory than this device can safely provide.";
    case "cancelled": return "PDF loading was cancelled.";
    default: return "Incrementum could not read this PDF. Try opening it again.";
  }
}

export function shouldRetryPdfWorker(error: NormalizedPdfError): boolean {
  return error.category === "unknown" || error.category === "resource_limit";
}

export type PdfRecoveryAction = "retry" | "download" | "locate" | "open-original" | "copy-diagnostics";

export function pdfRecoveryActionsFor(
  error: NormalizedPdfError,
  options: { hasSyncedFile?: boolean; hasLocalFile?: boolean } = {},
): PdfRecoveryAction[] {
  const actions: PdfRecoveryAction[] = [];
  if (error.recoverable) actions.push("retry");
  if (error.category === "source_missing") {
    if (options.hasSyncedFile) actions.push("download");
    else actions.push("locate");
  }
  if (options.hasLocalFile && ["pdf_corrupt", "pdf_unsupported", "source_unavailable", "resource_limit"].includes(error.category)) {
    actions.push("open-original");
  }
  actions.push("copy-diagnostics");
  return actions;
}
