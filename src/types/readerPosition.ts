export type PdfDest = {
  kind: "XYZ";
  left: number | null;
  top: number | null;
  zoom: number | null;
};

export type PdfSourceAnchorState = {
  fingerprint?: string | null;
  pageNumber: number;
  blockId?: string;
  textQuote?: string;
  rect?: { x: number; y: number; width: number; height: number };
  intraBlockOffset?: number;
  mappingConfidence?: number;
};

export type ViewState = {
  docId: string;
  pageNumber: number;
  scale: number;
  zoomMode?: "custom" | "fit-width" | "fit-page";
  rotation?: number;
  viewMode?: string;
  dest?: PdfDest | null;
  pdfAnchor?: PdfSourceAnchorState | null;
  scrollTop?: number | null;
  scrollLeft?: number | null;
  scrollPercent?: number | null;
  updatedAt: number;
  version?: number;
};
