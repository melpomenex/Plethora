export const PDF_FEATURE_KEYS = {
  nativeMobileRangeSource: "incrementum.feature.nativeMobilePdfRangeSource",
  semanticReflow: "incrementum.feature.pdfSemanticReflow",
} as const;

export type PdfFeature = keyof typeof PDF_FEATURE_KEYS;

const DEFAULTS: Record<PdfFeature, boolean> = {
  // The range source fixes a correctness issue and retains the legacy source as
  // a runtime override for one release cycle.
  nativeMobileRangeSource: true,
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

export function shouldUseNativeMobilePdfSource(options: {
  nativeMobile: boolean;
  fileType: string;
}): boolean {
  return options.nativeMobile
    && options.fileType.toLowerCase() === "pdf"
    && isPdfFeatureEnabled("nativeMobileRangeSource");
}
