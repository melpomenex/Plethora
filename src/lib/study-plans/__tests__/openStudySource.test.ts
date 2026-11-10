import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openStudySource } from '../openStudySource';
import type { StudySourceRefV1, StudySourceResolution } from '../../../types/studySource';

vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: vi.fn(() => true),
  };
});

vi.mock('../../../api/documents', () => ({
  getDocument: vi.fn(),
}));

vi.mock('../../../stores/documentStore', () => ({
  useDocumentStore: {
    getState: vi.fn(() => ({
      documents: [],
    })),
  },
}));

const mockAddTab = vi.fn();
vi.mock('../../../stores/tabsStore', () => ({
  useTabsStore: {
    getState: vi.fn(() => ({
      addTab: mockAddTab,
      getWorkspaceTabs: vi.fn(() => []),
      updateTab: vi.fn(),
      setActiveTab: vi.fn(),
    })),
  },
}));

vi.mock('../../../utils/openDocumentAtLocation', () => ({
  openDocumentAtLocation: vi.fn(),
}));

import { isTauri } from '../../../lib/tauri';
import { getDocument } from '../../../api/documents';
import { useDocumentStore } from '../../../stores/documentStore';
import { openDocumentAtLocation } from '../../../utils/openDocumentAtLocation';

describe('openStudySource', () => {
  const mockRef: StudySourceRefV1 = {
    schemaVersion: 1,
    id: 'ref-1',
    documentId: 'doc-123',
    excerpt: 'Machine learning fundamentals',
    revision: 'hash-abc',
    revisionKind: 'content-hash',
    excerptSha256: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    documentTitle: 'ML Textbook',
    sourceType: 'pdf',
    capturedAt: '2026-03-30T12:00:00Z',
    jump: { kind: 'pdf', pageNumber: 42, textQuote: 'Machine learning fundamentals' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: [
        {
          id: 'doc-123',
          title: 'ML Textbook',
          fileType: 'pdf',
          contentHash: 'hash-abc',
          dateModified: '2026-03-30T10:00:00Z',
        } as any,
      ],
    } as any);
    vi.mocked(openDocumentAtLocation).mockResolvedValue(true);
  });

  it('fails closed when not running in Tauri (unsupported platform)', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const result = await openStudySource(mockRef);
    expect(result).toEqual({
      success: false,
      reason: 'unsupported_platform',
      message: expect.stringContaining('native application support'),
    });
    expect(openDocumentAtLocation).not.toHaveBeenCalled();
  });

  it('fails closed for unsupported resolution status', async () => {
    const resolution: StudySourceResolution = {
      ref: mockRef,
      status: 'unsupported',
      navigation: 'unavailable',
    };
    const result = await openStudySource(resolution);
    expect(result).toEqual({
      success: false,
      reason: 'unsupported',
      message: 'Unsupported source type for navigation',
    });
  });

  it('fails closed for ambiguous resolution status', async () => {
    const resolution: StudySourceResolution = {
      ref: mockRef,
      status: 'ambiguous',
      navigation: 'unavailable',
    };
    const result = await openStudySource(resolution);
    expect(result).toEqual({
      success: false,
      reason: 'ambiguous',
      message: 'Multiple matching locations found for source excerpt',
    });
  });

  it('reports missing if document is not found in store or API', async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({ documents: [] } as any);
    vi.mocked(getDocument).mockResolvedValue(null as any);

    const result = await openStudySource(mockRef);
    expect(result).toEqual({
      success: false,
      reason: 'missing',
      message: 'Source document could not be found',
    });
  });

  it('reports stale if document revision changed and coarse navigation is disabled', async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: [
        {
          id: 'doc-123',
          title: 'ML Textbook',
          fileType: 'pdf',
          contentHash: 'new-hash-xyz',
        } as any,
      ],
    } as any);

    const result = await openStudySource(mockRef);
    expect(result).toEqual({
      success: false,
      reason: 'stale',
      message: 'Source document revision has changed since capture',
    });
    expect(openDocumentAtLocation).not.toHaveBeenCalled();
  });

  it('allows coarse navigation on stale if explicitly permitted', async () => {
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: [
        {
          id: 'doc-123',
          title: 'ML Textbook',
          fileType: 'pdf',
          contentHash: 'new-hash-xyz',
        } as any,
      ],
    } as any);

    const result = await openStudySource(mockRef, { allowCoarseNavigationOnStale: true });
    expect(result).toEqual({
      success: true,
      navigation: 'coarse',
    });
    expect(openDocumentAtLocation).toHaveBeenCalled();
  });

  it('opens standard PDF/EPUB document via openDocumentAtLocation with exact jump', async () => {
    const result = await openStudySource(mockRef);
    expect(result).toEqual({
      success: true,
      navigation: 'exact',
    });
    expect(openDocumentAtLocation).toHaveBeenCalledWith(
      'doc-123',
      {
        initialJump: mockRef.jump,
        highlightQuery: mockRef.excerpt,
      },
      expect.any(Function),
      undefined
    );
  });

  it('routes local video with extractId directly to focusedVideoExtractId payload', async () => {
    const videoRef: StudySourceRefV1 = {
      ...mockRef,
      sourceType: 'video',
      extractId: 'ext-vid-99',
    };
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      documents: [
        {
          id: 'doc-123',
          title: 'ML Lecture Video',
          fileType: 'video',
          contentHash: 'hash-abc',
        } as any,
      ],
    } as any);

    const result = await openStudySource(videoRef, {
      returnContext: { originPlanId: 'plan-1' },
    });

    expect(result).toEqual({
      success: true,
      navigation: 'exact',
    });
    // Video does NOT call generic openDocumentAtLocation
    expect(openDocumentAtLocation).not.toHaveBeenCalled();
    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'document-viewer',
        data: expect.objectContaining({
          documentId: 'doc-123',
          focusedVideoExtractId: 'ext-vid-99',
          hideRatingOrbs: true,
          originPlanId: 'plan-1',
        }),
      })
    );
  });
});
