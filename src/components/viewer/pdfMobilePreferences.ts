import type { PDFSettings } from "../../stores/settingsStore";

export type PdfMobilePreferences = Pick<PDFSettings,
  | "preferredMobileMode"
  | "reflowFontFamily"
  | "reflowFontSize"
  | "reflowLineHeight"
  | "reflowMargin"
  | "reflowDirection"
  | "reflowImageScaling"
  | "reflowTheme"
  | "fixedMobileMode"
  | "fixedColumns"
  | "fixedColumnDirection"
  | "fixedColumnOverlap"
>;

const PREFIX = "plethora.pdf.mobile.preferences:";

export function pdfMobilePreferencesFromSettings(settings: PDFSettings): PdfMobilePreferences {
  return {
    preferredMobileMode: settings.preferredMobileMode,
    reflowFontFamily: settings.reflowFontFamily,
    reflowFontSize: settings.reflowFontSize,
    reflowLineHeight: settings.reflowLineHeight,
    reflowMargin: settings.reflowMargin,
    reflowDirection: settings.reflowDirection,
    reflowImageScaling: settings.reflowImageScaling,
    reflowTheme: settings.reflowTheme,
    fixedMobileMode: settings.fixedMobileMode,
    fixedColumns: settings.fixedColumns,
    fixedColumnDirection: settings.fixedColumnDirection,
    fixedColumnOverlap: settings.fixedColumnOverlap,
  };
}

export function loadPdfMobilePreferences(documentId: string, defaults: PdfMobilePreferences): PdfMobilePreferences {
  if (typeof localStorage === "undefined") return defaults;
  try {
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}${documentId}`) ?? "null") as Partial<PdfMobilePreferences> | null;
    return stored ? { ...defaults, ...stored } : defaults;
  } catch {
    return defaults;
  }
}

export function savePdfMobilePreferences(documentId: string, preferences: PdfMobilePreferences): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${PREFIX}${documentId}`, JSON.stringify(preferences));
}
