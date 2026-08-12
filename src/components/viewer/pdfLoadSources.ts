export type PdfLoadSource = Record<string, unknown>;

export interface PdfLoadSourceFactory {
  create: () => PdfLoadSource;
}

interface CreatePdfLoadSourceFactoriesOptions {
  fileUrl?: string | null;
  fileData?: Uint8Array | null;
  disableFontFace: boolean;
}

/**
 * Defensive whole-file copy (task 6.7): `clonePdfData` exists only for the
 * whole-file fallback path — it protects against WebView2 detaching the IPC
 * ArrayBuffer during the structuredClone pdf.js performs when passing `data`
 * to its worker. The native range path never reaches this factory (PDFViewer
 * returns via the `useNativeRange` branch first, and DocumentViewer never sets
 * `fileData` when routing to the range source), so the range path holds no
 * whole-file buffer to clone.
 */
function clonePdfData(fileData: Uint8Array): Uint8Array {
  return new Uint8Array(fileData);
}

export function createPdfLoadSourceFactories({
  fileUrl,
  fileData,
  disableFontFace,
}: CreatePdfLoadSourceFactoriesOptions): PdfLoadSourceFactory[] {
  const sources: PdfLoadSourceFactory[] = [];

  if (fileUrl) {
    sources.push({
      create: () => ({
        url: fileUrl,
        verbosity: 0,
        disableRange: true,
        disableStream: true,
        disableAutoFetch: true,
        disableFontFace,
      }),
    });
  }

  if (fileData) {
    sources.push({
      create: () => ({
        data: clonePdfData(fileData),
        verbosity: 0,
        disableFontFace,
      }),
    });
  }

  return sources;
}
