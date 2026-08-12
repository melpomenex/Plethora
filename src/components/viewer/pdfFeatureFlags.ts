export const PDF_FEATURE_KEYS = {
  // The bounded-range PDF source (PDFDataRangeTransport over the native
  // read_pdf_document_range command). Enabled by default in the Tauri runtime
  // on desktop and mobile alike (design D10); the whole-file path remains as
  // an explicit fallback.
  nativePdfRangeSource: "incrementum.feature.nativePdfRangeSource",
  // Legacy key from the mobile-only rollout. Read as a fallback so a user who
  // disabled the flag before the rename keeps it disabled after.
  legacyNativeMobileRangeSource: "incrementum.feature.nativeMobilePdfRangeSource",
  semanticReflow: "incrementum.feature.pdfSemanticReflow",
} as const;

export type PdfFeature = keyof typeof PDF_FEATURE_KEYS;

const DEFAULTS: Record<PdfFeature, boolean> = {
  // The range source fixes a correctness issue (whole-file IPC buffers) and
  // retains the legacy source as a runtime override for one release cycle.
  nativePdfRangeSource: true,
  legacyNativeMobileRangeSource: true,
  // Reflow is enabled independently so source reliability can ship first.
  semanticReflow: false,
};

export function isPdfFeatureEnabled(feature: PdfFeature): boolean {
  if (typeof window === "undefined") return DEFAULTS[feature];
  const override = window.localStorage.getItem(PDF_FEATURE_KEYS[feature]);
  if (override === "true") return true;
  if (override === "false") return false;
  return DEFAULTS[feature];
}

/** The range-source flag, honoring the pre-rename mobile-only key. */
export function isNativePdfRangeEnabled(): boolean {
  if (typeof window === "undefined") return DEFAULTS.nativePdfRangeSource;
  const renamed = window.localStorage.getItem(PDF_FEATURE_KEYS.nativePdfRangeSource);
  if (renamed === "true") return true;
  if (renamed === "false") return false;
  // Migration: a user who disabled the mobile-only flag before the rename
  // should not silently gain the desktop range path.
  const legacy = window.localStorage.getItem(PDF_FEATURE_KEYS.legacyNativeMobileRangeSource);
  if (legacy === "true") return true;
  if (legacy === "false") return false;
  return DEFAULTS.nativePdfRangeSource;
}

/**
 * Platform-agnostic predicate for the bounded-range PDF source (task 6.1).
 *
 * Formerly `shouldUseNativeMobilePdfSource` (mobile-only); the range transport
 * and its Rust commands are registered on every platform, so the decision is
 * now "are we in the Tauri runtime at all". Web/PWA builds keep the
 * whole-file path because there is no native range command there.
 */
export function shouldUseNativePdfRangeSource(options: {
  isTauriRuntime: boolean;
  fileType: string;
}): boolean {
  return (
    options.isTauriRuntime
    && options.fileType.toLowerCase() === "pdf"
    && isNativePdfRangeEnabled()
  );
}

/** @deprecated use `shouldUseNativePdfRangeSource({ isTauriRuntime, fileType })`. */
export function shouldUseNativeMobilePdfSource(options: {
  nativeMobile: boolean;
  fileType: string;
}): boolean {
  return options.nativeMobile
    && options.fileType.toLowerCase() === "pdf"
    && isNativePdfRangeEnabled();
}
