import { describe, expect, it } from 'vitest';
import {
  buildEpubCfiLocator,
  buildExtractLocator,
  buildPdfAnchorLocator,
  buildVideoTimestampLocator,
  filterCloudEmbeddingCandidates,
} from '../types/rag';
import type { Document } from '../types/document';

describe('RAG Contracts & Locator Normalization', () => {
  it('builds PDF anchor locators', () => {
    const loc = buildPdfAnchorLocator(4, 'anchor_p4_w12');
    expect(loc.type).toBe('pdf');
    expect(loc.page).toBe(4);
    expect(loc.wordAnchor).toBe('anchor_p4_w12');
  });

  it('builds EPUB CFI locators', () => {
    const loc = buildEpubCfiLocator('epubcfi(/6/4[chapter1]!/4/2/10)');
    expect(loc.type).toBe('epub');
    expect(loc.cfi).toBe('epubcfi(/6/4[chapter1]!/4/2/10)');
  });

  it('builds Video timestamp locators', () => {
    const loc = buildVideoTimestampLocator(124.5);
    expect(loc.type).toBe('video');
    expect(loc.timestampSeconds).toBe(124.5);
  });

  it('builds Extract locators', () => {
    const loc = buildExtractLocator('ext-999');
    expect(loc.type).toBe('extract');
    expect(loc.extractId).toBe('ext-999');
  });

  it('filters out isLocalOnly documents from cloud embedding jobs', () => {
    const docs: Document[] = [
      {
        id: 'doc-1',
        title: 'Public Paper',
        filePath: '/path/1.pdf',
        fileType: 'pdf',
        tags: [],
        dateAdded: new Date().toISOString(),
        dateModified: new Date().toISOString(),
        extractCount: 0,
        learningItemCount: 0,
        priorityRating: 3,
        prioritySlider: 50,
        priorityScore: 50,
        isArchived: false,
        isFavorite: false,
      },
      {
        id: 'doc-2',
        title: 'Secret Private Journal',
        filePath: '/path/2.pdf',
        fileType: 'pdf',
        tags: [],
        dateAdded: new Date().toISOString(),
        dateModified: new Date().toISOString(),
        extractCount: 0,
        learningItemCount: 0,
        priorityRating: 3,
        prioritySlider: 50,
        priorityScore: 50,
        isArchived: false,
        isFavorite: false,
        isLocalOnly: true,
      },
    ];

    const eligible = filterCloudEmbeddingCandidates(docs);
    expect(eligible.length).toBe(1);
    expect(eligible[0].id).toBe('doc-1');
  });
});
