export type PdfReadingLayout = "continuous" | "single" | "spread" | "cover-spread";

export interface PdfViewPreferences {
  layout: PdfReadingLayout;
  direction: "ltr" | "rtl";
  rotation: 0 | 90 | 180 | 270;
}

const PREFIX = "plethora.pdf.view:";
export const PDF_VIEW_DEFAULTS: PdfViewPreferences = { layout: "continuous", direction: "ltr", rotation: 0 };

export function loadPdfViewPreferences(documentId: string): PdfViewPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + documentId) ?? "null") as Partial<PdfViewPreferences> | null;
    return {
      layout: value?.layout && ["continuous", "single", "spread", "cover-spread"].includes(value.layout)
        ? value.layout
        : PDF_VIEW_DEFAULTS.layout,
      direction: value?.direction === "rtl" ? "rtl" : "ltr",
      rotation: value?.rotation === 90 || value?.rotation === 180 || value?.rotation === 270 ? value.rotation : 0,
    };
  } catch {
    return PDF_VIEW_DEFAULTS;
  }
}

export function savePdfViewPreferences(documentId: string, value: PdfViewPreferences): void {
  try {
    localStorage.setItem(PREFIX + documentId, JSON.stringify(value));
  } catch {
    // View controls still work when persistent storage is unavailable.
  }
}

export function isPdfSpread(layout: PdfReadingLayout): boolean {
  return layout === "spread" || layout === "cover-spread";
}

export function pdfRowBounds(
  page: number,
  layout: PdfReadingLayout,
  first: number,
  last: number,
): readonly [start: number, end: number] {
  if (!isPdfSpread(layout) || page < first || page > last || layout === "cover-spread" && page === first) {
    return [page, page];
  }
  const origin = layout === "cover-spread" ? first + 1 : first;
  const start = origin + 2 * Math.floor((page - origin) / 2);
  return [start, Math.min(last, start + 1)];
}

export function buildPdfSpreadOffsets(
  count: number,
  layout: PdfReadingLayout,
  first: number,
  last: number,
  defaultHeight: number,
  measured: ReadonlyMap<number, number>,
  scale: number,
  gap: number,
): number[] {
  const offsets = new Array<number>(count + 1);
  let offset = 0;
  for (let page = 1; page <= count;) {
    const [, end] = pdfRowBounds(page, layout, first, last);
    let height = 0;
    for (; page <= end; page += 1) {
      offsets[page - 1] = offset;
      height = Math.max(height, measured.get(page - 1) ?? defaultHeight);
    }
    offset += height * scale + gap;
  }
  offsets[count] = offset;
  return offsets;
}
