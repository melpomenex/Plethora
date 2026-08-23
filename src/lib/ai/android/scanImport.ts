/**
 * Persist scanner JPEGs into the image registry, OCR cheaply, then create
 * a normal markdown document. Summaries/cards are not auto-enqueued.
 */

import { createDocument, updateDocumentContent } from "../../../api/documents";
import { ingestImageBlob } from "../../../api/image-registry";
import { getOnDeviceOcrLabels } from "../onDeviceAI";
import type { ScanImport, ScanPage } from "../capabilities/vision";

export interface ScanLibraryResult {
  documentId: string;
  assetIds: string[];
  ocrChars: number;
}

function pageMarkdown(pages: Array<ScanPage & { imageAssetId: string }>): string {
  return pages
    .map((page, index) => {
      const body = page.ocrText?.trim() || "";
      return [`## Page ${index + 1}`, "", body || "*(no text recognised)*", ""].join("\n");
    })
    .join("\n");
}

async function ocrPage(page: ScanPage): Promise<string> {
  if (page.ocrText?.trim()) return page.ocrText;
  if (!page.data) return "";
  try {
    const labels = await getOnDeviceOcrLabels(page.data);
    return labels.labels.map((label) => label.text).join("\n");
  } catch {
    return "";
  }
}

export async function importScanToLibrary(
  scan: ScanImport,
  ingest: typeof ingestImageBlob = ingestImageBlob
): Promise<ScanLibraryResult> {
  const stored: Array<ScanPage & { imageAssetId: string }> = [];
  for (const [index, page] of scan.pages.entries()) {
    let imageAssetId = page.imageAssetId;
    if (!imageAssetId && page.data) {
      const bytes = Uint8Array.from(atob(page.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: page.mimeType || "image/jpeg" });
      const asset = await ingest(blob, `scan-page-${index + 1}.jpg`);
      imageAssetId = asset.id;
    }
    if (!imageAssetId) continue;
    stored.push({
      ...page,
      imageAssetId,
      ocrText: await ocrPage({ ...page, imageAssetId }),
    });
  }
  const title = `Scan ${new Date().toISOString().slice(0, 10)}`;
  const doc = await createDocument(title, `scan://${Date.now()}`, "markdown");
  await updateDocumentContent(doc.id, pageMarkdown(stored));
  return {
    documentId: doc.id,
    assetIds: stored.map((page) => page.imageAssetId),
    ocrChars: stored.reduce((sum, page) => sum + (page.ocrText?.length ?? 0), 0),
  };
}
