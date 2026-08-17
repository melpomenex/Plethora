import { describe, it, expect } from 'vitest';
import { canReconstructDocument } from '../types/documentReconstruction';
import type { Document } from '../types/document';

describe('Document Reconstruction & Cloud OCR Eligibility', () => {
  it('allows cloud-eligible PDF and image documents', () => {
    const validPdf: Document = {
      id: 'doc-1',
      title: 'Scanned Research Paper',
      filePath: '/test/paper.pdf',
      fileType: 'pdf',
      tags: [],
      isLocalOnly: false,
      isAiExcluded: false,
      dateAdded: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 3,
      prioritySlider: 50,
      priorityScore: 50,
      isArchived: false,
      isFavorite: false,
      isDismissed: false,
      readingCount: 0,
    };

    expect(canReconstructDocument(validPdf)).toBe(true);

    const validImage: Document = {
      ...validPdf,
      id: 'doc-2',
      fileType: 'image',
    };
    expect(canReconstructDocument(validImage)).toBe(true);
  });

  it('rejects local-only or AI-excluded documents from cloud reconstruction', () => {
    const localOnlyDoc: Document = {
      id: 'doc-3',
      title: 'Confidential Internal Memo',
      filePath: '/test/memo.pdf',
      fileType: 'pdf',
      tags: [],
      isLocalOnly: true,
      isAiExcluded: false,
      dateAdded: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 3,
      prioritySlider: 50,
      priorityScore: 50,
      isArchived: false,
      isFavorite: false,
      isDismissed: false,
      readingCount: 0,
    };

    expect(canReconstructDocument(localOnlyDoc)).toBe(false);

    const aiExcludedDoc: Document = {
      ...localOnlyDoc,
      isLocalOnly: false,
      isAiExcluded: true,
    };

    expect(canReconstructDocument(aiExcludedDoc)).toBe(false);
  });
});
