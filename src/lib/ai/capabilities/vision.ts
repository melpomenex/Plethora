import type { PlatformCapabilityDescriptor } from "./types";

export interface ScanPage {
  imageAssetId: string;
  width: number;
  height: number;
  ocrText?: string;
}

export interface ScanImport {
  pages: ScanPage[];
  documentId?: string;
}

export interface ScanDocumentRequest {
  maxPages?: number;
  allowGallery?: boolean;
  signal?: AbortSignal;
}

export interface RecognizeTextRequest {
  imageAssetId?: string;
  sourceUri?: string;
  signal?: AbortSignal;
}

export interface VisionScanProvider {
  readonly id: string;
  getCapability(): Promise<PlatformCapabilityDescriptor>;
  scanDocument(req?: ScanDocumentRequest): Promise<ScanImport>;
  recognizeText?(req: RecognizeTextRequest): Promise<{ text: string }>;
}
