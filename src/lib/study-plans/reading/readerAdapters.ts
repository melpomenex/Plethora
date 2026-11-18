import type { StudyReadingSegment, StudyTrailNavigationStatus } from '../../../types/studyReading';
import type { EpubVimRuntime, PdfVimRuntime } from '../../../utils/vim/readerRuntimes';
import { paintReadingPassage, readingRangeVisible, readingStartInViewport, revealReadingRange } from './paintReadingPassage';
import {
  createReadingRangeResolver, normalizeReadingQuote, rangesInOrder, renderedRangeMatches, uniqueQuote,
} from './resolveReadingRange';
import { coarseStudyJump, type TrailRequest } from './trailController';

type Report = (status: StudyTrailNavigationStatus) => void;
type Cleanup = () => void;

const MAX_EPUB_SEARCH_SECTIONS = 256;
const MAX_CACHED_RANGES = 256;
const EPUB_LOCATOR_CACHE = 'plethora.study-reading.epub-locators.v1';
const verifiedEpubRanges = new Map<string, string>();
let readCache = false;

function cachedEpubCfi(key: string) {
  if (!readCache) {
    readCache = true;
    try {
      const entries: unknown = JSON.parse(localStorage.getItem(EPUB_LOCATOR_CACHE) ?? '[]');
      if (Array.isArray(entries)) {
        for (const row of entries.slice(-MAX_CACHED_RANGES)) {
          if (Array.isArray(row) && typeof row[0] === 'string' && row[0].length < 800 &&
              typeof row[1] === 'string' && row[1].length < 1000) {
            verifiedEpubRanges.set(row[0], row[1]);
          }
        }
      }
    } catch { /* storage can be unavailable in an ephemeral session */ }
  }
  return verifiedEpubRanges.get(key);
}

function rememberEpubCfi(key: string, cfi: string) {
  if (verifiedEpubRanges.size >= MAX_CACHED_RANGES) {
    const oldest = verifiedEpubRanges.keys().next().value;
    if (oldest) verifiedEpubRanges.delete(oldest);
  }
  verifiedEpubRanges.set(key, cfi);
  try { localStorage.setItem(EPUB_LOCATOR_CACHE, JSON.stringify([...verifiedEpubRanges])); } catch { /* optional cache */ }
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T | null, signal: AbortSignal, timeoutMs = 3500): Promise<T | null> {
  const expires = Date.now() + timeoutMs;
  while (Date.now() < expires) {
    signal.throwIfAborted();
    const value = read();
    if (value) return value;
    await delay(40);
  }
  return null;
}

function unresolved(request: TrailRequest, status: 'missing' | 'unsupported' | 'ambiguous') {
  if (status === 'ambiguous') return status;
  return coarseStudyJump(request.assignment) ? 'coarse' : 'unsupported';
}

function spineFromCfi(cfi: string | undefined) {
  const step = cfi?.match(/^epubcfi\(\/\d+\/(\d+)(?:\[|!|\/)/)?.[1];
  return step && Number(step) % 2 === 0 ? Number(step) / 2 - 1 : undefined;
}

function epubBodyRoot(doc: Document): Element | null {
  return doc.querySelector('body') ?? doc.body ?? doc.documentElement;
}

function firstAndLastTextNodes(root: Element): { first: Text | null; last: Text | null } {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const first = walker.nextNode() as Text | null;
  let last = first;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    last = n;
  }
  return { first, last };
}

async function searchEpubSections(
  sections: EpubVimRuntime['sections'],
  quote: StudyReadingSegment['quote'],
  signal: AbortSignal,
) {
  let match: { cfi: string; spineIndex: number; range: Range } | undefined;
  for (const section of sections) {
    const doc = await section.load(signal);
    const root = epubBodyRoot(doc);
    if (!root) continue;
    const result = createReadingRangeResolver(root, false, true)(quote);
    if (result.status === 'ambiguous') return result;
    if (result.status !== 'exact') continue;
    const cfi = section.cfiForDomRange?.(result.range);
    if (!cfi) return { status: 'unsupported' } as const;
    if (match) return { status: 'ambiguous' } as const;
    match = { cfi, spineIndex: section.spineIndex, range: result.range };
  }
  return match ? ({ status: 'exact', ...match } as const) : ({ status: 'missing' } as const);
}

async function findEpubSegment(
  runtime: EpubVimRuntime,
  request: TrailRequest,
  segment: StudyReadingSegment,
  index: number,
  signal: AbortSignal,
  preferredSpineIndex?: number,
) {
  const { documentId, documentRevision, id } = request.assignment;
  const cacheKey = JSON.stringify([documentId, documentRevision, id, index]);
  const cached = cachedEpubCfi(cacheKey);
  const location = segment.location?.kind === 'epub' ? segment.location : undefined;
  for (const cfi of new Set([cached, location?.cfiRange])) {
    if (!cfi || !runtime.bookRangeFromCfi) continue;
    const native = await runtime.bookRangeFromCfi(cfi);
    signal.throwIfAborted();
    const spineIndex = spineFromCfi(cfi);
    if (spineIndex !== undefined && native && renderedRangeMatches(native, segment.quote)) {
      return { status: 'exact', cfi, spineIndex, range: native } as const;
    }
  }
  if (cached) verifiedEpubRanges.delete(cacheKey);
  if (!runtime.sections.length || runtime.sections.length > MAX_EPUB_SEARCH_SECTIONS) {
    return { status: 'unsupported' } as const;
  }

  const hint = segment.spineIndex ?? spineFromCfi(location?.cfi || location?.cfiRange);
  const scoped = hint !== undefined
    ? runtime.sections.find((section) => section.spineIndex === hint)
    : undefined;
  if (scoped) {
    const scopedResult = await searchEpubSections([scoped], segment.quote, signal);
    if (scopedResult.status === 'exact') {
      rememberEpubCfi(cacheKey, scopedResult.cfi);
      return scopedResult;
    }
    if (scopedResult.status === 'ambiguous' || scopedResult.status === 'unsupported') {
      return scopedResult;
    }
  }

  // Fallback across sections (prioritizing preferredSpineIndex and adjacent spine for end boundary)
  const remaining = runtime.sections.filter((section) => section !== scoped);
  if (preferredSpineIndex !== undefined) {
    remaining.sort((a, b) => {
      const rank = (s: number) => (s === preferredSpineIndex ? 0 : s === preferredSpineIndex + 1 ? 1 : s > preferredSpineIndex ? 2 : 3);
      return rank(a.spineIndex) - rank(b.spineIndex) || a.spineIndex - b.spineIndex;
    });
  }
  const fullResult = await searchEpubSections(remaining, segment.quote, signal);
  if (fullResult.status === 'exact') rememberEpubCfi(cacheKey, fullResult.cfi);
  return fullResult;
}

export async function attachEpubPassage(
  runtime: EpubVimRuntime,
  request: TrailRequest,
  signal: AbortSignal,
  jump: boolean,
  report: Report,
): Promise<Cleanup | undefined> {
  if (runtime.documentId !== request.assignment.documentId || !runtime.renderedSections) return;
  const matches: Array<{ cfi: string; spineIndex: number; range: Range; segment: StudyReadingSegment }> = [];
  for (const [index, segment] of request.assignment.segments.entries()) {
    const result = await findEpubSegment(
      runtime,
      request,
      segment,
      index,
      signal,
      matches[0]?.spineIndex,
    );
    if (result.status !== 'exact') {
      if (index > 0 && matches.length > 0) break;
      report(unresolved(request, result.status));
      return;
    }
    const previous = matches[index - 1];
    if (previous && (previous.spineIndex > result.spineIndex ||
        (previous.spineIndex === result.spineIndex &&
          previous.range.startContainer.ownerDocument === result.range.startContainer.ownerDocument &&
          !rangesInOrder(previous.range, result.range)))) {
      if (index > 0) break;
      report('ambiguous');
      return;
    }
    matches.push({ ...result, segment });
  }
  const first = matches[0];
  if (!first) return;
  if (jump) {
    const start = first.range.cloneRange();
    start.collapse(true);
    const section = runtime.sections.find((item) => item.spineIndex === first.spineIndex);
    await runtime.reveal(section?.cfiForDomRange?.(start) || first.cfi, signal);
  }
  signal.throwIfAborted();

  const resolveRendered = (root: HTMLElement, item: typeof first) => {
    const native = runtime.rangeFromCfi(item.cfi);
    if (native && root.contains(native.startContainer) && renderedRangeMatches(native, item.segment.quote)) return native;
    const resolved = createReadingRangeResolver(root)(item.segment.quote);
    return resolved.status === 'exact' ? resolved.range : null;
  };
  if (jump) {
    let aligned = false;
    const rendered = await waitFor(() => {
      const root = runtime.renderedSections?.().find((view) => view.spineIndex === first.spineIndex)?.root;
      const range = root && resolveRendered(root, first);
      if (!range || !readingRangeVisible(range)) return null;
      if (readingStartInViewport(range)) return range;
      if (!aligned) {
        aligned = true;
        runtime.alignReadingStart?.(range);
        return null;
      }
      return range;
    }, signal);
    if (!rendered) {
      report(unresolved(request, 'missing'));
      return;
    }
  }

  const decorations = new Map<Element, Cleanup>();
  function paint() {
    if (signal.aborted) return;
    const views = runtime.renderedSections?.() ?? [];
    for (const [root, remove] of decorations) {
      if (views.some((view) => view.root === root)) continue;
      remove();
      decorations.delete(root);
    }
    for (const { root, spineIndex } of views) {
      if (decorations.has(root)) continue;
      const resolvedInSpine = matches.flatMap((item, index) => {
        if (item.spineIndex !== spineIndex) return [];
        const range = resolveRendered(root, item);
        return range ? [{ range, index }] : [];
      });
      let items: Array<{ range: Range; start: boolean; end: boolean }> = [];
      if (
        resolvedInSpine.length === 2 &&
        matches.length === 2 &&
        resolvedInSpine[0].index === 0 &&
        resolvedInSpine[1].index === 1
      ) {
        try {
          const spanned = root.ownerDocument.createRange();
          spanned.setStart(resolvedInSpine[0].range.startContainer, resolvedInSpine[0].range.startOffset);
          spanned.setEnd(resolvedInSpine[1].range.endContainer, resolvedInSpine[1].range.endOffset);
          items = [{ range: spanned, start: true, end: true }];
        } catch {
          items = resolvedInSpine.map(({ range, index }) => ({
            range,
            start: index === 0,
            end: index === matches.length - 1,
          }));
        }
      } else if (matches.length === 2 && matches[0].spineIndex < matches[1].spineIndex) {
        if (spineIndex === matches[0].spineIndex && resolvedInSpine.length) {
          const startRange = resolvedInSpine[0].range;
          const { last } = firstAndLastTextNodes(root);
          const spanned = root.ownerDocument.createRange();
          spanned.setStart(startRange.startContainer, startRange.startOffset);
          if (last) spanned.setEnd(last, last.length);
          else spanned.setEnd(startRange.endContainer, startRange.endOffset);
          items = [{ range: spanned, start: true, end: false }];
        } else if (spineIndex === matches[1].spineIndex && resolvedInSpine.length) {
          const endRange = resolvedInSpine[0].range;
          const { first } = firstAndLastTextNodes(root);
          const spanned = root.ownerDocument.createRange();
          if (first) spanned.setStart(first, 0);
          else spanned.setStart(endRange.startContainer, endRange.startOffset);
          spanned.setEnd(endRange.endContainer, endRange.endOffset);
          items = [{ range: spanned, start: false, end: true }];
        } else if (spineIndex > matches[0].spineIndex && spineIndex < matches[1].spineIndex) {
          const { first, last } = firstAndLastTextNodes(root);
          if (first && last) {
            const full = root.ownerDocument.createRange();
            full.setStart(first, 0);
            full.setEnd(last, last.length);
            items = [{ range: full, start: false, end: false }];
          }
        }
      } else {
        items = resolvedInSpine.map(({ range, index }) => ({
          range,
          start: index === 0,
          end: index === matches.length - 1,
        }));
      }
      if (items.length) decorations.set(root, paintReadingPassage(root, items, request.id));
    }
  }
  paint();
  const unsubscribe = runtime.subscribe((event) => { if (event.kind !== 'destroyed') paint(); });
  if (jump) report('exact');
  return () => { unsubscribe(); decorations.forEach((remove) => remove()); };
}

export async function attachPdfPassage(
  runtime: PdfVimRuntime,
  request: TrailRequest,
  signal: AbortSignal,
  jump: boolean,
  report: Report,
): Promise<Cleanup | undefined> {
  if (runtime.documentId !== request.assignment.documentId) return;
  const pages = new Map<number, Array<{ segment: StudyReadingSegment; index: number }>>();
  let previousPage = 0;
  for (const [index, segment] of request.assignment.segments.entries()) {
    const page = segment.location?.kind === 'pdf' ? segment.location.pageNumber : 0;
    if (page < 1 || page > runtime.pageCount || !Number.isInteger(page)) {
      if (jump) report(unresolved(request, 'unsupported'));
      return;
    }
    if (page < previousPage) { if (jump) report('ambiguous'); return; }
    previousPage = page;
    const entries = pages.get(page) ?? [];
    entries.push({ segment, index });
    pages.set(page, entries);
  }
  const firstPage = pages.keys().next().value;
  if (!firstPage) return;
  const lastPage = Array.from(pages.keys()).at(-1) ?? firstPage;
  const spanAcrossShortPdfRange = request.assignment.segments.length === 2 && lastPage > firstPage && lastPage - firstPage <= 3;

  const resolvePage = (root: HTMLElement, entries: NonNullable<ReturnType<typeof pages.get>>) => {
    const nativeTextLayer = root.classList.contains('textLayer');
    const resolve = createReadingRangeResolver(root, nativeTextLayer);
    let joinItems: ReturnType<typeof createReadingRangeResolver> | undefined;
    const ranges: Array<{ range: Range; start: boolean; end: boolean }> = [];
    for (const { segment, index } of entries) {
      let result = resolve(segment.quote);
      if (result.status === 'missing' && nativeTextLayer) {
        joinItems ??= createReadingRangeResolver(root);
        result = joinItems(segment.quote);
      }
      if (result.status !== 'exact') return result;
      const previous = ranges.at(-1);
      if (previous && !rangesInOrder(previous.range, result.range)) return { status: 'ambiguous' } as const;
      ranges.push({ range: result.range, start: index === 0, end: index === request.assignment.segments.length - 1 });
    }
    if (ranges.length === 2 && request.assignment.segments.length === 2) {
      try {
        const spanned = root.ownerDocument.createRange();
        spanned.setStart(ranges[0].range.startContainer, ranges[0].range.startOffset);
        spanned.setEnd(ranges[1].range.endContainer, ranges[1].range.endOffset);
        return { status: 'exact', ranges: [{ range: spanned, start: true, end: true }] } as const;
      } catch { /* fall back to endpoint ranges */ }
    } else if (spanAcrossShortPdfRange && ranges.length === 1) {
      const pageNum = entries[0]?.segment.location?.kind === 'pdf' ? entries[0].segment.location.pageNumber : 0;
      const { first, last } = firstAndLastTextNodes(root);
      if (pageNum === firstPage && last) {
        try {
          const spanned = root.ownerDocument.createRange();
          spanned.setStart(ranges[0].range.startContainer, ranges[0].range.startOffset);
          spanned.setEnd(last, last.length);
          return { status: 'exact', ranges: [{ range: spanned, start: true, end: false }] } as const;
        } catch { /* keep resolved range */ }
      } else if (pageNum === lastPage && first) {
        try {
          const spanned = root.ownerDocument.createRange();
          spanned.setStart(first, 0);
          spanned.setEnd(ranges[0].range.endContainer, ranges[0].range.endOffset);
          return { status: 'exact', ranges: [{ range: spanned, start: false, end: true }] } as const;
        } catch { /* keep resolved range */ }
      }
    }
    return { status: 'exact', ranges } as const;
  };
  if (jump) {
    await runtime.revealPage(firstPage, signal);
    for (const [page, entries] of pages) {
      // Use PDF.js-backed text on virtualized pages. The overlay independently
      // re-verifies the rendered text layer when each page mounts.
      const root = page === firstPage
        ? await waitFor(() => {
          const layer = runtime.textLayer(page);
          return layer?.isConnected && layer.textContent?.trim() ? layer : null;
        }, signal) : runtime.textLayer(page);
      if (root?.isConnected && root.textContent?.trim()) {
        const result = resolvePage(root, entries);
        if (result.status !== 'exact') { report(unresolved(request, result.status)); return; }
        if (page === firstPage && !revealReadingRange(result.ranges[0].range) && !readingRangeVisible(result.ranges[0].range)) {
          report('coarse');
          return;
        }
      } else if (page === firstPage) {
        report('coarse');
        return;
      } else {
        const items = await runtime.loadPageText(page, signal);
        const spaced = normalizeReadingQuote(items.map(({ str }) => str).join(' '));
        const joined = normalizeReadingQuote(items.map(({ str, hasEOL }) => str + (hasEOL ? ' ' : '')).join(''));
        let previousEnd = 0;
        for (const { segment } of entries) {
          const match = uniqueQuote(spaced || joined, segment.quote);
          if (match.status !== 'exact' || match.start < previousEnd) {
            report(match.status === 'ambiguous' || match.status === 'exact' ? 'ambiguous' : 'coarse');
            return;
          }
          previousEnd = match.end;
        }
      }
    }
  }

  const painted = new Map<number, { root: HTMLElement; remove: Cleanup }>();
  const paintPages = new Set<number>(pages.keys());
  if (spanAcrossShortPdfRange) {
    for (let p = firstPage + 1; p < lastPage; p += 1) paintPages.add(p);
  }
  function paint(forcePage?: number) {
    if (signal.aborted) return;
    for (const page of paintPages) {
      const root = runtime.textLayer(page);
      const existing = painted.get(page);
      if (existing && root === existing.root && root.isConnected && forcePage !== page) continue;
      existing?.remove();
      painted.delete(page);
      if (!root?.isConnected) continue;
      const entries = pages.get(page);
      let rangesToPaint: ReadonlyArray<{ range: Range; start: boolean; end: boolean }> | undefined;
      if (entries) {
        const result = resolvePage(root, entries);
        if (result.status === 'exact') rangesToPaint = result.ranges;
      } else if (spanAcrossShortPdfRange) {
        const { first, last } = firstAndLastTextNodes(root);
        if (first && last) {
          const full = root.ownerDocument.createRange();
          full.setStart(first, 0);
          full.setEnd(last, last.length);
          rangesToPaint = [{ range: full, start: false, end: false }];
        }
      }
      const removeMarks = rangesToPaint
        ? paintReadingPassage(root, rangesToPaint, request.id * 10000 + page, true)
        : undefined;
      const observer = new MutationObserver(() => paint(page));
      observer.observe(root, { subtree: true, childList: true, characterData: true });
      painted.set(page, {
        root, remove: () => { observer.disconnect(); removeMarks?.(); },
      });
    }
  }
  paint();
  const unsubscribe = runtime.subscribe((event) => {
    if (event.kind === 'content') paint(event.pageNumber);
    else if (event.kind === 'geometry') paint();
  });
  if (jump) report('exact');
  return () => { unsubscribe(); painted.forEach(({ remove }) => remove()); };
}
