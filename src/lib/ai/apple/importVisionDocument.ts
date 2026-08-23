import { createDocument, updateDocumentContent } from "../../../api/documents";
import { ingestImageFromPath } from "../../../api/image-registry";
import { useDocumentStore } from "../../../stores/documentStore";
import type { Document } from "../../../types/document";
import { applePresentScanner, appleRecognizeDocument, type AppleVisionDocument } from "./vision";

function titleFromVision(doc: AppleVisionDocument, fallback: string): string {
  const line = (doc.text || "").split(/\n+/).map((s) => s.trim()).find(Boolean);
  if (line && line.length > 0) {
    return line.slice(0, 80);
  }
  return fallback;
}

export async function persistVisionDocument(
  recognized: AppleVisionDocument,
  options: { filePath?: string; title?: string } = {},
): Promise<Document> {
  const filePath = options.filePath ?? `scan://apple/${Date.now()}`;
  const title = options.title ?? titleFromVision(recognized, "Scanned document");
  const fileType = options.filePath ? "image" : "markdown";
  const created = await createDocument(title, filePath, fileType);
  const body = recognized.html?.trim() || recognized.text || "";
  let doc = created;
  if (body) {
    doc = await updateDocumentContent(created.id, body);
  }
  if (options.filePath) {
    try {
      await ingestImageFromPath(options.filePath);
    } catch {
      // Keep the recognized text even if the image asset cannot be ingested.
    }
  }
  useDocumentStore.getState().addDocument(doc);
  return doc;
}

export async function importAppleDocumentScan(): Promise<Document> {
  const recognized = await applePresentScanner();
  return persistVisionDocument(recognized);
}

export async function importApplePhotoDocument(filePath: string): Promise<Document> {
  const recognized = await appleRecognizeDocument("photo", undefined, filePath);
  return persistVisionDocument(recognized, { filePath });
}
