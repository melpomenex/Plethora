import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyReadingAssignment } from '../../../types/studyReading';
import type { EpubVimRuntime, PdfVimRuntime } from '../../../utils/vim/readerRuntimes';
import { attachEpubPassage, attachPdfPassage } from './readerAdapters';
import type { TrailRequest } from './trailController';

function makeChapterDoc(bodyHtml: string, title = 'Book Title Should Be Ignored') {
  const doc = document.implementation.createHTMLDocument(title);
  doc.body.innerHTML = bodyHtml;
  Object.defineProperty(doc, 'defaultView', { value: window, configurable: true });
  return doc;
}

const sampleRect = {
  x: 40,
  y: 120,
  left: 40,
  top: 120,
  right: 320,
  bottom: 140,
  width: 280,
  height: 20,
  toJSON() {
    return this;
  },
} as DOMRect;

let originalGetClientRects: (() => DOMRectList) | undefined;

beforeEach(() => {
  localStorage.clear();
  originalGetClientRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function getClientRectsStub() {
    const list = [sampleRect] as unknown as DOMRectList & DOMRect[];
    list.item = (index: number) => list[index] ?? null;
    return list;
  };
});

afterEach(() => {
  if (originalGetClientRects) {
    Range.prototype.getClientRects = originalGetClientRects;
  }
  vi.restoreAllMocks();
});

function makeTrailRequest(
  id: number,
  assignment: StudyReadingAssignment,
): TrailRequest {
  return {
    id,
    assignment,
    signal: new AbortController().signal,
    coarse: false,
  };
}

describe('readerAdapters guided reading passages', () => {
  it('falls back across EPUB spines when hinted spineIndex misses and renders non-blocking start/end decorations', async () => {
    const coverDoc = makeChapterDoc('<p>Cover page and copyright information.</p>');
    const chapterDoc = makeChapterDoc(
      '<p><span class="stickup">A</span>n evolutionary lens reveals why natural selection designed feelings to mislead us about permanence. Seeing that illusion clearly is the heart of meditation.</p>',
    );

    const listeners = new Set<(event: { kind: 'content' | 'geometry' | 'destroyed'; spineIndex?: number }) => void>();
    const runtime: EpubVimRuntime = {
      documentId: 'doc-epub-fallback-1',
      sections: [
        {
          spineIndex: 0,
          href: 'cover.xhtml',
          load: async () => coverDoc,
          cfiForElement: () => 'epubcfi(/6/2!/4/2)',
          cfiForTextOffset: () => 'epubcfi(/6/2!/4/2/1:0)',
          cfiForRange: async () => 'epubcfi(/6/2!/4/2/1:0)',
          cfiForDomRange: () => 'epubcfi(/6/2!/4/2/1:0)',
        },
        {
          spineIndex: 7,
          href: 'ch1.xhtml',
          load: async () => chapterDoc,
          cfiForElement: () => 'epubcfi(/6/16!/4/2)',
          cfiForTextOffset: () => 'epubcfi(/6/16!/4/2/1:0)',
          cfiForRange: async () => 'epubcfi(/6/16!/4/2/1:0)',
          cfiForDomRange: () => 'epubcfi(/6/16!/4/2/1:0)',
        },
      ],
      currentSpineIndex: () => 7,
      currentCfi: () => 'epubcfi(/6/16!/4/2/1:0)',
      currentWindow: () => window,
      reveal: vi.fn(async () => {}),
      rangeFromCfi: () => null,
      cfiFromRange: () => 'epubcfi(/6/16!/4/2/1:0)',
      renderedSections: () => [{ spineIndex: 7, root: chapterDoc.body }],
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    const request = makeTrailRequest(101, {
      schemaVersion: 1,
      id: 'assign-epub-1',
      topicId: 'topic-1',
      documentId: 'doc-epub-fallback-1',
      documentTitle: 'Why Buddhism is True',
      documentRevision: 'rev-1',
      format: 'epub',
      objectiveIndexes: [0],
      sourceRefIds: [],
      segments: [
        {
          spineIndex: 0, // Incorrect legacy hint; quote actually lives in spine 7
          quote: { exact: 'An evolutionary lens reveals why natural selection' },
          location: { kind: 'epub', cfi: '', textQuote: 'An evolutionary lens reveals why natural selection' },
        },
        {
          spineIndex: 0,
          quote: { exact: 'Seeing that illusion clearly is the heart of meditation.' },
          location: { kind: 'epub', cfi: '', textQuote: 'Seeing that illusion clearly is the heart of meditation.' },
        },
      ],
    });

    const report = vi.fn();
    const cleanup = await attachEpubPassage(runtime, request, request.signal, true, report);

    expect(report).toHaveBeenCalledWith('exact');
    expect(runtime.reveal).toHaveBeenCalledTimes(1);
    expect(cleanup).toBeTypeOf('function');

    const decorationLayer = chapterDoc.body.querySelector<HTMLElement>('[data-study-decoration]');
    expect(decorationLayer).not.toBeNull();
    expect(decorationLayer?.style.pointerEvents).toBe('none');
    expect(decorationLayer?.style.userSelect).toBe('none');
    expect(chapterDoc.body.querySelector('[data-study-boundary="rail"]')).not.toBeNull();
    expect(chapterDoc.body.querySelector('[data-study-boundary="start"]')).not.toBeNull();
    expect(chapterDoc.body.querySelector('[data-study-boundary="end"]')).not.toBeNull();

    cleanup?.();
    expect(chapterDoc.body.querySelector('[data-study-decoration]')).toBeNull();
  });

  it('keeps EPUB start passage and renders decoration even when endQuote fails to match', async () => {
    const chapterDoc = makeChapterDoc(
      '<p>Natural selection cares about reproductive success rather than accurate perception of reality.</p>',
    );

    const runtime: EpubVimRuntime = {
      documentId: 'doc-epub-startonly-2',
      sections: [
        {
          spineIndex: 2,
          href: 'ch2.xhtml',
          load: async () => chapterDoc,
          cfiForElement: () => 'epubcfi(/6/6!/4/2)',
          cfiForTextOffset: () => 'epubcfi(/6/6!/4/2/1:0)',
          cfiForRange: async () => 'epubcfi(/6/6!/4/2/1:0)',
          cfiForDomRange: () => 'epubcfi(/6/6!/4/2/1:0)',
        },
      ],
      currentSpineIndex: () => 2,
      currentCfi: () => 'epubcfi(/6/6!/4/2/1:0)',
      currentWindow: () => window,
      reveal: vi.fn(async () => {}),
      rangeFromCfi: () => null,
      cfiFromRange: () => 'epubcfi(/6/6!/4/2/1:0)',
      renderedSections: () => [{ spineIndex: 2, root: chapterDoc.body }],
      subscribe: () => () => {},
    };

    const request = makeTrailRequest(102, {
      schemaVersion: 1,
      id: 'assign-epub-2',
      topicId: 'topic-2',
      documentId: 'doc-epub-startonly-2',
      documentTitle: 'Test EPUB',
      documentRevision: 'rev-1',
      format: 'epub',
      objectiveIndexes: [0],
      sourceRefIds: [],
      segments: [
        {
          spineIndex: 2,
          quote: { exact: 'Natural selection cares about reproductive success' },
          location: { kind: 'epub', cfi: '', textQuote: 'Natural selection cares about reproductive success' },
        },
        {
          spineIndex: 2,
          quote: { exact: 'This trailing quote does not exist anywhere in the DOM' },
          location: { kind: 'epub', cfi: '', textQuote: 'This trailing quote does not exist anywhere in the DOM' },
        },
      ],
    });

    const report = vi.fn();
    const cleanup = await attachEpubPassage(runtime, request, request.signal, true, report);

    expect(report).toHaveBeenCalledWith('exact');
    expect(chapterDoc.body.querySelector('[data-study-decoration]')).not.toBeNull();
    expect(chapterDoc.body.querySelector('[data-study-boundary="start"]')).not.toBeNull();
    cleanup?.();
  });

  it('spans startQuote to endQuote on the same PDF page and renders study boundary overlay', async () => {
    const pageContainer = document.createElement('div');
    pageContainer.className = 'textLayer';
    pageContainer.innerHTML = [
      '<span role="presentation">Rule 4: Stick to the minimum information principle.</span>',
      '<span role="presentation">Simple items are easier to schedule and repeat accurately.</span>',
      '<span role="presentation">Avoid complex sets that overwhelm working memory during review.</span>',
    ].join('');
    document.body.replaceChildren(pageContainer);

    const runtime: PdfVimRuntime = {
      documentId: 'doc-pdf-span-1',
      pageCount: 10,
      currentPageNumber: () => 3,
      loadPageText: async () => [
        { str: 'Rule 4: Stick to the minimum information principle.', hasEOL: true },
        { str: 'Simple items are easier to schedule and repeat accurately.', hasEOL: true },
        { str: 'Avoid complex sets that overwhelm working memory during review.', hasEOL: true },
      ],
      revealPage: vi.fn(async () => {}),
      textLayer: (page) => (page === 3 ? pageContainer : null),
      pageSelectionContext: () => null,
      subscribe: () => () => {},
    };

    const request = makeTrailRequest(201, {
      schemaVersion: 1,
      id: 'assign-pdf-1',
      topicId: 'topic-pdf',
      documentId: 'doc-pdf-span-1',
      documentTitle: '20 Rules',
      documentRevision: 'rev-pdf',
      format: 'pdf',
      objectiveIndexes: [0],
      sourceRefIds: [],
      segments: [
        {
          quote: { exact: 'Stick to the minimum information principle.' },
          location: { kind: 'pdf', pageNumber: 3, textQuote: 'Stick to the minimum information principle.' },
        },
        {
          quote: { exact: 'that overwhelm working memory during review.' },
          location: { kind: 'pdf', pageNumber: 3, textQuote: 'that overwhelm working memory during review.' },
        },
      ],
    });

    const report = vi.fn();
    const cleanup = await attachPdfPassage(runtime, request, request.signal, true, report);

    expect(report).toHaveBeenCalledWith('exact');
    expect(runtime.revealPage).toHaveBeenCalledWith(3, request.signal);

    const overlay = document.body.querySelector<HTMLElement>('[data-study-decoration]');
    expect(overlay).not.toBeNull();
    expect(overlay?.style.pointerEvents).toBe('none');
    expect(document.body.querySelector('[data-study-boundary="rail"]')).not.toBeNull();
    expect(document.body.querySelector('[data-study-boundary="start"]')).not.toBeNull();
    expect(document.body.querySelector('[data-study-boundary="end"]')).not.toBeNull();

    cleanup?.();
    expect(document.body.querySelector('[data-study-decoration]')).toBeNull();
  });
});
