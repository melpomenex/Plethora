import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  catalogItemFromDocument,
  isItemSelectableForStudyScope,
  prepareStudySource,
} from '../universalSourceAdapter';
import type { StudySourceCatalogItem } from '../../../types/studySource';

describe('universalSourceAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses preparation actions without explicit user consent', async () => {
    const item: StudySourceCatalogItem = {
      id: 'doc-scan',
      kind: 'document',
      documentId: 'doc-scan',
      title: 'Scanned PDF',
      fileType: 'pdf',
      sourceCategory: 'pdf',
      readiness: 'needs-ocr',
      isAiExcluded: false,
      isLocalOnly: false,
      chunkCount: 0,
      revision: '2026-11-10',
      revisionKind: 'modified-at',
      dateAdded: '2026-11-10',
      tags: [],
      prepareAction: 'run-ocr',
    };

    await expect(prepareStudySource(item, { consentGranted: false })).rejects.toThrow(
      /explicit user confirmation/i
    );
  });

  it('blocks selection and preparation of ai-excluded sources', async () => {
    const item = catalogItemFromDocument({
      id: 'doc-priv',
      title: 'Private Notes',
      filePath: '/priv.md',
      fileType: 'markdown',
      content: 'private text',
      isAiExcluded: true,
      isLocalOnly: false,
      dateAdded: '2026-11-10',
      dateModified: '2026-11-10',
      tags: [],
      category: '',
      isFavorite: false,
      isArchived: false,
      priorityScore: 0,
      priorityRating: 0,
      prioritySlider: 0,
      extractCount: 0,
      learningItemCount: 0,
      readingCount: 0,
      collectionId: 'col-1',
    } as any);

    expect(item.readiness).toBe('ai-excluded');
    expect(isItemSelectableForStudyScope(item)).toBe(false);
    await expect(
      prepareStudySource({ ...item, prepareAction: 'finish-indexing' }, { consentGranted: true })
    ).rejects.toThrow(/ai-excluded/i);
  });
});
