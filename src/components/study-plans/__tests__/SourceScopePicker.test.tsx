import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { SourceScopePicker } from '../SourceScopePicker';
import * as docApi from '../../../api/documents';
import * as studySourcesApi from '../../../api/study-sources';
import * as tauriLib from '../../../lib/tauri';
import * as adapter from '../../../lib/study-plans/universalSourceAdapter';
import type { SelectedSourceScope } from '../../../types/studySource';

vi.mock('../../../api/documents', () => ({
  getDocuments: vi.fn(),
}));

vi.mock('../../../api/study-sources', async () => {
  const actual = await vi.importActual<typeof import('../../../api/study-sources')>('../../../api/study-sources');
  return {
    ...actual,
    getStudySourceCatalog: vi.fn(),
    ensurePodcastEpisodeDocument: vi.fn(),
    ensureRssArticleDocument: vi.fn(),
  };
});

vi.mock('../../../lib/tauri', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/tauri')>('../../../lib/tauri');
  return {
    ...actual,
    isTauri: vi.fn(() => false),
  };
});

describe('SourceScopePicker', () => {
  const mockDocs = [
    { id: 'doc_1', title: 'Calculus Early Transcendentals' },
    { id: 'doc_2', title: 'Linear Algebra Done Right' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriLib.isTauri).mockReturnValue(false);
  });

  it('renders documents and toggles selection', async () => {
    vi.mocked(docApi.getDocuments).mockResolvedValue(mockDocs as any);
    const onChange = vi.fn();
    const selectedScope: SelectedSourceScope = {
      documentIds: [],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    };

    render(
      <SourceScopePicker
        selectedScope={selectedScope}
        onChange={onChange}
        maxDocuments={24}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Calculus Early Transcendentals')).toBeInTheDocument();
    });

    // Click on Calculus
    fireEvent.click(screen.getByText('Calculus Early Transcendentals'));
    expect(onChange).toHaveBeenCalledWith({
      documentIds: ['doc_1'],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    });
  });

  it('enforces maxDocuments bound with alert notice', async () => {
    vi.mocked(docApi.getDocuments).mockResolvedValue(mockDocs as any);
    const onChange = vi.fn();
    const selectedScope: SelectedSourceScope = {
      documentIds: ['doc_1'],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    };

    render(
      <SourceScopePicker
        selectedScope={selectedScope}
        onChange={onChange}
        maxDocuments={1} // Cap at 1 for test
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/maximum 1 source documents reached/i);
    });

    // Clicking doc_2 while at limit should not add it
    fireEvent.click(screen.getByText('Linear Algebra Done Right'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders empty library notice when library has no documents', async () => {
    vi.mocked(docApi.getDocuments).mockResolvedValue([]);
    const onChange = vi.fn();

    render(
      <SourceScopePicker
        selectedScope={{ documentIds: [], extractIds: [], collectionIds: [], tagIds: [] }}
        onChange={onChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/no material in library/i)).toBeInTheDocument();
    });
  });

  it('displays readiness badges, gates unready sources without auto-prep, and promotes ready RSS items on selection', async () => {
    vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    const prepSpy = vi.spyOn(adapter, 'prepareStudySource');
    vi.mocked(studySourcesApi.getStudySourceCatalog).mockResolvedValue([
      {
        id: 'doc-scan',
        kind: 'document',
        documentId: 'doc-scan',
        title: 'Scanned Workbook',
        fileType: 'pdf',
        sourceCategory: 'pdf',
        readiness: 'needs-ocr',
        readinessReason: 'Needs OCR',
        isAiExcluded: false,
        isLocalOnly: false,
        chunkCount: 0,
        revision: '2026-11-10',
        revisionKind: 'modified-at',
        dateAdded: '2026-11-10',
        tags: [],
        prepareAction: 'run-ocr',
      },
      {
        id: 'doc-excl',
        kind: 'document',
        documentId: 'doc-excl',
        title: 'Private Journal',
        fileType: 'markdown',
        sourceCategory: 'markdown',
        readiness: 'ai-excluded',
        isAiExcluded: true,
        isLocalOnly: false,
        chunkCount: 0,
        revision: '2026-11-10',
        revisionKind: 'modified-at',
        dateAdded: '2026-11-10',
        tags: [],
      },
      {
        id: 'rss:art-1',
        kind: 'rss-article',
        title: 'Rust Async Internals',
        fileType: 'html',
        sourceCategory: 'rss',
        readiness: 'ready',
        isAiExcluded: false,
        isLocalOnly: false,
        chunkCount: 0,
        revision: 'sha256:rss1',
        revisionKind: 'content-hash',
        dateAdded: '2026-11-10',
        tags: ['rust'],
        prepareAction: 'promote-rss',
      },
    ]);
    vi.mocked(studySourcesApi.ensureRssArticleDocument).mockResolvedValue({
      documentId: 'doc-rss-promoted',
      promoted: true,
      title: 'Rust Async Internals',
      sourceType: 'html',
      readiness: 'ready',
      revision: 'sha256:rss1',
      revisionKind: 'content-hash',
      isAiExcluded: false,
      isLocalOnly: false,
    });

    const onChange = vi.fn();
    render(
      <SourceScopePicker
        selectedScope={{ documentIds: [], extractIds: [], collectionIds: [], tagIds: [] }}
        onChange={onChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Scanned Workbook')).toBeInTheDocument();
      expect(screen.getByText('Rust Async Internals')).toBeInTheDocument();
    });

    // Must not auto-trigger OCR on render
    expect(prepSpy).not.toHaveBeenCalled();

    // Unready and AI-excluded checkboxes are disabled; explicit consent button rendered only for unready non-excluded
    expect(screen.getByRole('checkbox', { name: 'Scanned Workbook' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Private Journal' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run OCR' })).toBeInTheDocument();

    // Clicking ready RSS article promotes it and adds promoted documentId
    fireEvent.click(screen.getByRole('checkbox', { name: 'Rust Async Internals' }));
    await waitFor(() => {
      expect(studySourcesApi.ensureRssArticleDocument).toHaveBeenCalledWith('art-1');
      expect(onChange).toHaveBeenCalledWith({
        documentIds: ['doc-rss-promoted'],
        extractIds: [],
        collectionIds: [],
        tagIds: [],
      });
    });
    prepSpy.mockRestore();
  });
});
