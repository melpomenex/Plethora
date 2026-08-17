import type { Document } from './document';
import { isCloudEligible } from './privacy';

export type ReconstructionQuality = 'fast' | 'thorough';

export interface DocumentReconstructOptions {
  documentId: string;
  pageRange?: [number, number];
  quality: ReconstructionQuality;
  ocrLang?: string;
  preserveImages?: boolean;
}

export interface DocumentReconstructResult {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processedPages: number;
  totalPages: number;
  error?: string;
}

/**
 * Ensures a document is eligible for cloud reconstruction.
 * Local-only and AI-excluded documents are rejected immediately.
 */
export function canReconstructDocument(doc: Document): boolean {
  if (!isCloudEligible(doc)) {
    return false;
  }
  if (doc.isAiExcluded === true || (doc.metadata as Record<string, unknown> | undefined)?.isAiExcluded === true) {
    return false;
  }
  return doc.fileType === 'pdf' || doc.fileType === 'image';
}
