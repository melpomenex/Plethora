import type { StudyReadingQuote, StudyReadingSegment } from '../../../types/studyReading';

const blocks = 'article,aside,blockquote,dd,div,dl,dt,figcaption,figure,h1,h2,h3,h4,h5,h6,li,main,ol,p,pre,section,table,td,th,tr,ul';
const ignored = 'head,title,script,style,noscript,template,rt,[hidden],[aria-hidden="true"],[data-study-decoration]';
const MAX_INDEX_LENGTH = 350_000;

type Match = { status: 'exact'; range: Range } | { status: 'ambiguous' | 'missing' | 'unsupported' };
interface Point { node: Text; start: number; end: number }

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '-',
  ndash: '-',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

function decodeBasicEntities(value: string) {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1]?.toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? full;
  });
}

function normalizeCharacters(value: string) {
  return decodeBasicEntities(value).normalize('NFKC').toLowerCase()
    .replace(/[‘’‚‛′]/gu, "'")
    .replace(/[“”„‟″]/gu, '"')
    .replace(/[–—―−]/gu, '-')
    .replace(/[\u00ad\u200b\ufeff]/gu, '');
}

export function normalizeReadingQuote(value: string) {
  return normalizeCharacters(value).replace(/\s+/gu, ' ').trim();
}

function normalizePiece(value: string) {
  const unit = value.charCodeAt(0);
  if (value.length === 1 && unit < 128) {
    return unit >= 65 && unit <= 90 ? String.fromCharCode(unit + 32) : value;
  }
  return normalizeCharacters(value);
}

function matchCandidate(text: string, needle: string, prefix: string, suffix: string) {
  let bare = -1;
  let confirmed = -1;
  let count = 0;
  let confirmations = 0;
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) {
    bare = index;
    count += 1;
    const end = index + needle.length;
    const prefixEnd = index - Number(text[index - 1] === ' ');
    const suffixStart = end + Number(text[end] === ' ');
    const prefixMatches = prefixEnd >= prefix.length && text.startsWith(prefix, prefixEnd - prefix.length);
    if (prefixMatches && text.startsWith(suffix, suffixStart)) {
      confirmed = index;
      confirmations += 1;
    }
    if (confirmations > 1) return { status: 'ambiguous' } as const;
  }
  if (count === 0) return { status: 'missing' } as const;
  const start = confirmations === 1 ? confirmed : count === 1 ? bare : -1;
  return start >= 0
    ? { status: 'exact', start, end: start + needle.length } as const
    : { status: 'ambiguous' } as const;
}

function anchorWindows(exact: string): string[] {
  const words = exact.split(' ').filter(Boolean);
  if (words.length < 6) return [];
  const candidates: string[] = [];
  const pushWindow = (slice: string[]) => {
    if (slice.length < 5) return;
    const joined = slice.join(' ');
    if (joined.length >= 28 && !candidates.includes(joined)) candidates.push(joined);
  };
  // Trim clipped edge words from legacy fixed-char locators
  pushWindow(words.slice(0, -1));
  pushWindow(words.slice(1));
  pushWindow(words.slice(1, -1));
  // Word-aligned ~65-char windows from start, middle, and end (also tolerating minor prefix drift)
  const buildFrom = (startWord: number) => {
    let acc = '';
    const slice: string[] = [];
    for (let i = startWord; i < words.length; i += 1) {
      const next = acc ? `${acc} ${words[i]}` : words[i];
      if (next.length > 72 && slice.length >= 5) break;
      acc = next;
      slice.push(words[i]);
    }
    pushWindow(slice);
  };
  buildFrom(0);
  buildFrom(Math.min(3, words.length - 5));
  buildFrom(Math.max(0, Math.floor(words.length / 2) - 3));
  buildFrom(Math.max(0, words.length - 8));
  return candidates;
}

export function uniqueQuote(text: string, quote: StudyReadingQuote) {
  const exact = normalizeReadingQuote(quote.exact);
  if (!exact) return { status: 'missing' } as const;
  const prefix = normalizeReadingQuote(quote.prefix ?? '');
  const suffix = normalizeReadingQuote(quote.suffix ?? '');
  const direct = matchCandidate(text, exact, prefix, suffix);
  if (direct.status !== 'missing' || exact.length < 45) return direct;

  let anyAmbiguous = false;
  for (const anchor of anchorWindows(exact)) {
    const hit = matchCandidate(text, anchor, '', '');
    if (hit.status === 'exact') return hit;
    if (hit.status === 'ambiguous') anyAmbiguous = true;
  }
  return anyAmbiguous ? ({ status: 'ambiguous' } as const) : ({ status: 'missing' } as const);
}

/**
 * Flatten visible prose with synthetic separators at block boundaries. Each
 * normalized code unit maps to its complete source grapheme, including NFC
 * composition and compatibility characters such as ligatures.
 */
export function indexReadingText(root: Element, pdfItems = false, indexDetached = false) {
  const doc = root.ownerDocument;
  const points: Array<Point | null> = [];
  const parts: string[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      if (element.matches(ignored) ||
          (element as HTMLElement).style?.display === 'none' ||
          (element as HTMLElement).style?.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      return element.localName === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let previousBlock: Element | null = null;
  let pendingSpace = false;
  let length = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) {
      pendingSpace = true;
      continue;
    }
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent) continue;
    const block = parent.closest(pdfItems ? '.textLayer span[role="presentation"], .textLayer > span' : blocks) ?? root;
    if (previousBlock && block !== previousBlock) pendingSpace = true;
    previousBlock = block;
    for (const match of text.data.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
      const value = normalizePiece(match[0]);
      if (!value) continue;
      if (/^\s+$/u.test(value)) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && length) {
        parts.push(' ');
        points.push(null);
        length += 1;
      }
      pendingSpace = false;
      const point = { node: text, start: match.index!, end: match.index! + match[0].length };
      parts.push(value);
      for (let i = 0; i < value.length; i += 1) points.push(point);
      length += value.length;
      if (length > MAX_INDEX_LENGTH) return null;
    }
  }
  if (!indexDetached && !root.isConnected) return null;
  return { text: parts.join(''), points };
}

export function createReadingRangeResolver(root: Element, pdfItems = false, indexDetached = false) {
  const index = indexReadingText(root, pdfItems, indexDetached);
  return (quote: StudyReadingQuote): Match => {
    if (!index) return { status: 'unsupported' };
    const match = uniqueQuote(index.text, quote);
    if (match.status !== 'exact') return match;
    const first = index.points[match.start];
    const last = index.points[match.end - 1];
    if (!first || !last || first === index.points[match.start - 1] || last === index.points[match.end]) {
      return { status: 'missing' };
    }
    const range = root.ownerDocument.createRange();
    range.setStart(first.node, first.start);
    range.setEnd(last.node, last.end);
    return { status: 'exact', range };
  };
}

export function resolveDomPassage(root: Element, segments: StudyReadingSegment[]) {
  let resolve: ReturnType<typeof createReadingRangeResolver> | undefined;
  const ranges: Range[] = [];
  for (const segment of segments) {
    const selector = segment.location?.kind === 'html'
      ? segment.location.selector
      : segment.location?.kind === 'pdf'
        ? `#page-${segment.location.pageNumber}`
        : undefined;
    let scope: Element | undefined;
    if (selector) {
      try {
        const elements = root.querySelectorAll(selector);
        if (elements.length === 1) scope = elements[0];
      } catch { /* A changed selector can fall back to the quote. */ }
    }
    if (!scope && segment.heading) {
      const heading = normalizeReadingQuote(segment.heading);
      const matches = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .filter((item) => normalizeReadingQuote(item.textContent ?? '') === heading);
      if (matches.length === 1) {
        const section = matches[0].closest('section,article');
        if (section && root.contains(section)) scope = section;
      }
    }
    const scoped = scope && createReadingRangeResolver(scope)(segment.quote);
    const result = scoped?.status === 'exact' || scoped?.status === 'ambiguous'
      ? scoped : (resolve ??= createReadingRangeResolver(root))(segment.quote);
    if (result.status !== 'exact') return result;
    const previous = ranges[ranges.length - 1];
    if (previous && !rangesInOrder(previous, result.range)) return { status: 'ambiguous' } as const;
    ranges.push(result.range);
  }
  return { status: 'exact', ranges } as const;
}

export function rangesInOrder(first: Range, second: Range) {
  const firstEnd = first.cloneRange();
  const secondStart = second.cloneRange();
  firstEnd.collapse(false);
  secondStart.collapse(true);
  return firstEnd.compareBoundaryPoints(Range.START_TO_START, secondStart) <= 0;
}

export function renderedRangeMatches(range: Range, quote: StudyReadingQuote) {
  if (normalizeReadingQuote(range.toString()) === normalizeReadingQuote(quote.exact)) return true;
  const doc = range.startContainer.ownerDocument;
  if (!doc) return false;
  const root = doc.createElement('div');
  root.appendChild(range.cloneContents());
  return indexReadingText(root, false, true)?.text === normalizeReadingQuote(quote.exact);
}
