import type { StudyReadingSegment, StudyTrailNavigationStatus } from '../../../types/studyReading';
import type { EpubVimRuntime, PdfVimRuntime } from '../../../utils/vim/readerRuntimes';
import { paintReadingPassage, readingRangeVisible, readingStartInViewport, revealReadingRange } from './paintReadingPassage';
import {
  createReadingRangeResolver, normalizeReadingQuote, rangesInOrder, renderedRangeMatches, uniqueQuote,
} from './resolveReadingRange';
import { coarseStudyJump, type TrailRequest } from './trailController';

type Report = (status: StudyTrailNavigationStatus) => void;
type Cleanup = () => void;

const MAX_EPUB_SEARCH_SECTIONS = 48;
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

async function findEpubSegment(
  runtime: EpubVimRuntime,
  request: TrailRequest,
  segment: StudyReadingSegment,
  index: number,
  signal: AbortSignal,
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
  const hint = segment.spineIndex ?? spineFromCfi(location?.cfi || location?.cfiRange);
  const scoped = runtime.sections.find((section) => section.spineIndex === hint);
  const sections = scoped ? [scoped] : runtime.sections;
  if (!sections.length || sections.length > MAX_EPUB_SEARCH_SECTIONS) return { status: 'unsupported' } as const;

  let match: { cfi: string; spineIndex: number; range: Range } | undefined;
  for (const section of sections) {
    const doc = await section.load(signal);
    const root = doc.body ?? doc.documentElement;
    if (!root) continue;
    const result = createReadingRangeResolver(root, false, true)(segment.quote);
    if (result.status === 'ambiguous') return result;
    if (result.status !== 'exact') continue;
    const cfi = section.cfiForDomRange?.(result.range);
    if (!cfi) return { status: 'unsupported' } as const;
    if (match) return { status: 'ambiguous' } as const;
    match = { cfi, spineIndex: section.spineIndex, range: result.range };
  }
  if (!match) return { status: 'missing' } as const;
  rememberEpubCfi(cacheKey, match.cfi);
  return { status: 'exact', ...match } as const;
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
    const result = await findEpubSegment(runtime, request, segment, index, signal);
    if (result.status !== 'exact') {
      report(unresolved(request, result.status));
      return;
    }
    const previous = matches[index - 1];
    if (previous && (previous.spineIndex > result.spineIndex ||
        (previous.spineIndex === result.spineIndex &&
          previous.range.startContainer.ownerDocument === result.range.startContainer.ownerDocument &&
          !rangesInOrder(previous.range, result.range)))) {
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
      }
      return null;
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
      const items = matches.flatMap((item, index) => {
        if (item.spineIndex !== spineIndex) return [];
        const range = resolveRendered(root, item);
        return range ? [{ range, start: index === 0, end: index === matches.length - 1 }] : [];
      });
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
        if (page === firstPage && !revealReadingRange(result.ranges[0].range)) { report('coarse'); return; }
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
  function paint(forcePage?: number) {
    if (signal.aborted) return;
    for (const [page, entries] of pages) {
      const root = runtime.textLayer(page);
      const existing = painted.get(page);
      if (existing && root === existing.root && root.isConnected && forcePage !== page) continue;
      existing?.remove();
      painted.delete(page);
      if (!root?.isConnected) continue;
      const result = resolvePage(root, entries);
      const removeMarks = result.status === 'exact'
        ? paintReadingPassage(root, result.ranges, request.id * 10000 + page, true)
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
