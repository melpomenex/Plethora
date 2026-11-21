import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveActionEnvelope } from '../execution';
import { captureAction, type ActionTarget } from '../model';
import { useSettingsStore } from '../../../../stores/settingsStore';

vi.mock('../../../../api/documents', () => ({
  getDocument: vi.fn().mockResolvedValue({ id: 'doc-1', contentHash: 'hash-1' }),
  extractDocumentText: vi.fn(),
}));

vi.mock('../../../documentQa/sectionContextRequest', () => ({
  loadDocumentQaText: vi.fn(),
}));

describe('resolveActionEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ai: {
          ...state.settings.ai,
          maxTokens: 50000,
        },
      },
    }));
  });

  it('retains untruncated full canonical transcript and sets coverage full for document targets', async () => {
    const { loadDocumentQaText } = await import('../../../documentQa/sectionContextRequest');
    // Generate ~30,000 words synthetic transcript text
    const words = Array.from({ length: 30000 }, (_, i) => `word${i}`).join(' ');
    vi.mocked(loadDocumentQaText).mockResolvedValue(words);

    const target: ActionTarget = {
      key: 'doc-target',
      owner: 'document:doc-1',
      kind: 'document',
      sourceType: 'video',
      documentId: 'doc-1',
      title: 'Long 2-Hour Video',
      content: '',
      coverage: 'full',
      labelKey: 'document',
    };

    const action = captureAction('key-points', target, 'document');
    const resolved = await resolveActionEnvelope(action, 'openrouter', {
      id: 'or-1',
      provider: 'openrouter',
      name: 'OpenRouter',
      apiKey: 'test-key',
      model: 'anthropic/claude-3.5-sonnet',
      enabled: true,
      temperature: 0.7,
      maxTokens: 4096,
    });

    expect(resolved.target.resolved).toBe(true);
    expect(resolved.target.coverage).toBe('full');
    expect(resolved.target.content).toBe(words);
    expect(resolved.target.content.length).toBeGreaterThan(100000);
  });

  it('keeps an unresolved document retry bound to the original PDF', async () => {
    const { loadDocumentQaText } = await import('../../../documentQa/sectionContextRequest');
    vi.mocked(loadDocumentQaText).mockResolvedValue('');
    const loadPageText = vi.fn(async () => 'Text from the newly opened PDF.');
    const target: ActionTarget = {
      key: 'doc-target', owner: 'document:doc-1', kind: 'document', sourceType: 'document',
      documentId: 'doc-1', title: 'Original PDF', content: '', coverage: 'window', labelKey: 'document',
    };

    await expect(resolveActionEnvelope(captureAction('explain', target, 'document'), 'openrouter', undefined, {
      pdfPageSource: { documentId: 'doc-2', version: 'other', pageCount: 4, isCurrent: () => true, loadPageText },
    })).rejects.toMatchObject({ key: 'assistant.actions.documentTextUnavailable' });
    expect(loadPageText).not.toHaveBeenCalled();
  });

  it('incorporates globalContextTokens from useSettingsStore into policy resolution', async () => {
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ai: {
          ...state.settings.ai,
          maxTokens: 64000,
        },
      },
    }));

    const target: ActionTarget = {
      key: 'sel-target',
      owner: 'document:doc-1',
      kind: 'selection',
      sourceType: 'video',
      documentId: 'doc-1',
      title: 'Short selection',
      content: Array.from({ length: 5000 }, (_, i) => `token${i}`).join(' '),
      coverage: 'window',
      labelKey: 'selection',
    };

    const action = captureAction('explain', target, 'document');
    const resolved = await resolveActionEnvelope(action, 'openrouter', {
      id: 'or-1',
      provider: 'openrouter',
      name: 'OpenRouter',
      apiKey: 'test-key',
      model: 'anthropic/claude-3.5-sonnet',
      enabled: true,
      temperature: 0.7,
      maxTokens: 4096,
    });

    expect(resolved.target.resolved).toBe(true);
    // With 64,000 global context tokens and ~5,000 words, promptBudget * 0.55 is > 15,000 tokens,
    // so 5,000 words easily fits without being head-truncated to 2,000 tokens!
    expect(resolved.target.content).toContain('token4999');
  });

  it('resolves section body from canonical PDF text when captured before section text loaded', async () => {
    const { loadDocumentQaText } = await import('../../../documentQa/sectionContextRequest');
    const { useDocumentOutlineStore } = await import('../../../../stores/documentOutlineStore');
    const { convertPdfOutlineToSectionNodes } = await import('../../../../utils/sectionIndex');

    const pdfOutline = [
      { title: 'Chapter 1: Intro', pageNumber: 1 },
      { title: 'Chapter 2: Evolution of the Major Programming Languages', pageNumber: 2 },
      { title: 'Chapter 3: Describing Syntax', pageNumber: 3 },
    ];
    useDocumentOutlineStore.getState().setOutline('pdf-doc-1', { pdfOutline });

    const outlineNodes = convertPdfOutlineToSectionNodes(pdfOutline);
    const ch2 = outlineNodes[1];

    const pdfHtml = [
      '<div class="page" id="page-1"><div class="page-header">Page 1 of 3</div><div class="page-content"><p>Intro text</p></div></div>',
      '<div class="page" id="page-2"><div class="page-header">Page 2 of 3</div><div class="page-content"><p>Zuse created Plankalkul in 1945 and Fortran followed in 1957.</p></div></div>',
      '<div class="page" id="page-3"><div class="page-header">Page 3 of 3</div><div class="page-content"><p>BNF grammar rules.</p></div></div>',
    ].join('\n');
    vi.mocked(loadDocumentQaText).mockResolvedValue(pdfHtml);

    const target: ActionTarget = {
      key: 'sec-target',
      owner: 'document:pdf-doc-1',
      kind: 'sections',
      sourceType: 'document',
      documentId: 'pdf-doc-1',
      title: 'Concepts of Programming Languages',
      sectionIds: [ch2.id],
      content: `${ch2.title}\n`,
      coverage: 'chunks',
      locator: ch2.title,
      labelKey: 'sections',
      sourceContext: {
        documentId: 'pdf-doc-1',
        sectionIds: [ch2.id],
        labels: [ch2.title],
        contentHash: 'h',
        contextKey: 'k',
        ranges: [],
      },
    };

    const action = captureAction('explain', target, 'document');
    const resolved = await resolveActionEnvelope(action, 'openrouter', {
      id: 'or-1',
      provider: 'openrouter',
      name: 'OpenRouter',
      apiKey: 'test-key',
      model: 'anthropic/claude-3.5-sonnet',
      enabled: true,
      temperature: 0.7,
      maxTokens: 4096,
    });

    expect(resolved.target.resolved).toBe(true);
    expect(resolved.target.content).toContain('Zuse created Plankalkul in 1945');
    expect(resolved.target.content).not.toContain('BNF grammar rules');
    expect(resolved.target.sourceContext?.ranges?.length).toBeGreaterThan(0);
  });

  it('loads the selected PDF chapter through the reader when the library text is empty', async () => {
    const { loadDocumentQaText } = await import('../../../documentQa/sectionContextRequest');
    const { useDocumentOutlineStore } = await import('../../../../stores/documentOutlineStore');
    const { buildSectionsSnapshot } = await import('../../../../utils/sectionIndex');
    const pdfOutline = [
      { title: 'Chapter 2', pageNumber: 57, items: [{ title: 'Chapter 2.1', pageNumber: 58 }] },
      { title: 'Chapter 3', pageNumber: 62 },
    ];
    const documentId = 'reader-pdf';
    useDocumentOutlineStore.getState().setOutline(documentId, { pdfOutline });
    const { flat } = buildSectionsSnapshot(documentId, '', { pdfOutline });
    vi.mocked(loadDocumentQaText).mockResolvedValue('');
    const loadPageText = vi.fn(async (page: number) => `Evidence from physical page ${page}. ${'A readable paragraph. '.repeat(160)}`);
    const target: ActionTarget = {
      key: 'chapter', owner: 'document:reader-pdf', kind: 'sections', sourceType: 'document',
      documentId, sectionIds: [flat[0].id], content: 'Chapter 2', locator: 'Chapter 2',
      coverage: 'chunks', labelKey: 'sections',
    };
    const resolved = await resolveActionEnvelope(captureAction('summarize', target, 'chat'), 'openrouter', {
      id: 'fixture', name: 'OpenRouter', provider: 'openrouter', model: 'fixture-model', apiKey: 'fixture',
      enabled: true, temperature: 0.2, maxTokens: 320, contextWindowTokens: 2048,
    }, {
      pdfPageSource: { documentId, version: 'reader-1', pageCount: 784, isCurrent: () => true, loadPageText },
    });

    expect(loadDocumentQaText).not.toHaveBeenCalled();
    expect(loadPageText.mock.calls.flat()).toEqual([57, 58, 59, 60, 61]);
    expect(resolved.target.content).toContain('Evidence from physical page 57');
    expect(resolved.target.content).toContain('Evidence from physical page 61');
    expect(resolved.target.content).toContain('Some text was omitted');
    expect(resolved.target.coverage).toBe('window');
  });

  it('blocks retries of old title-only actions when the source body is unavailable', async () => {
    const { loadDocumentQaText } = await import('../../../documentQa/sectionContextRequest');
    vi.mocked(loadDocumentQaText).mockResolvedValue('');
    const target: ActionTarget = {
      key: 'legacy', owner: 'document:pdf', kind: 'sections', sourceType: 'document',
      documentId: 'pdf', sectionIds: ['chapter-id'], content: 'Chapter 2\n', locator: 'Chapter 2',
      coverage: 'chunks', labelKey: 'sections', resolved: true,
    };
    await expect(resolveActionEnvelope(captureAction('summarize', target, 'chat'), 'openrouter'))
      .rejects.toMatchObject({ key: 'assistant.actions.sectionTextUnavailable' });
  });
});
