/**
 * DOM-based word highlighting in EPUB iframe content by char offset.
 * Caches the char index per iframe body and only unwraps the prior highlight
 * span between word transitions (no full re-walk on every tick).
 */

export const AUDIOBOOK_SYNC_WORD_CLASS = "audiobook-sync-word";
const WORD_CLASS = AUDIOBOOK_SYNC_WORD_CLASS;
const SENTENCE_CLASS = "audiobook-sync-sentence";
const INTERP_CLASS = "audiobook-sync-word--interpolated";

interface IndexedChar {
  node: Text;
  offset: number;
  normIndex: number;
}

interface IndexCacheEntry {
  signature: string;
  chars: IndexedChar[];
  text: string;
}

const indexCache = new WeakMap<HTMLElement, IndexCacheEntry>();
const previousHighlights = new WeakMap<Document, HTMLElement[]>();

function containerSignature(body: HTMLElement): string {
  return `${body.childNodes.length}:${body.textContent?.length ?? 0}`;
}

function buildIndex(body: HTMLElement): { chars: IndexedChar[]; text: string } {
  const chars: IndexedChar[] = [];
  let text = "";
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const value = node.textContent ?? "";
    for (let offset = 0; offset < value.length; offset++) {
      const ch = value[offset];
      if (/\s/.test(ch)) {
        if (text.length > 0 && !text.endsWith(" ")) text += " ";
        continue;
      }
      chars.push({ node, offset, normIndex: text.length });
      text += ch;
    }
  }
  return { chars, text };
}

function getCachedIndex(body: HTMLElement): { chars: IndexedChar[]; text: string } {
  const signature = containerSignature(body);
  const cached = indexCache.get(body);
  if (cached && cached.signature === signature) {
    return { chars: cached.chars, text: cached.text };
  }
  const built = buildIndex(body);
  indexCache.set(body, { signature, ...built });
  return built;
}

function invalidateIndex(body: HTMLElement | null | undefined): void {
  if (body) indexCache.delete(body);
}

export function normalizeSpineHref(href: string): string {
  return href.replace(/^\.?\//, "").split("#")[0].toLowerCase();
}

/** Match epub.js `contents.url` to an alignment chapter href. */
export function hrefMatchesChapter(contentsUrl: string, chapterHref: string): boolean {
  const u = normalizeSpineHref(contentsUrl);
  const c = normalizeSpineHref(chapterHref);
  if (u === c) return true;
  if (u.endsWith(`/${c}`) || c.endsWith(`/${u}`)) return true;
  const uBase = u.split("/").pop() ?? u;
  const cBase = c.split("/").pop() ?? c;
  return uBase === cBase && uBase.length > 0;
}

function unwrapHighlightSpans(doc: Document): void {
  const tracked = previousHighlights.get(doc) ?? [];
  for (const el of tracked) {
    const parent = el.parentNode;
    if (!parent) continue;
    parent.replaceChild(doc.createTextNode(el.textContent ?? ""), el);
    parent.normalize();
  }
  previousHighlights.set(doc, []);
  invalidateIndex(doc.body);
}

function clearHighlights(doc: Document): void {
  doc.querySelectorAll(`.${WORD_CLASS}, .${SENTENCE_CLASS}`).forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(doc.createTextNode(el.textContent ?? ""), el);
      parent.normalize();
    }
  });
  previousHighlights.set(doc, []);
  invalidateIndex(doc.body);
}

function injectStyles(doc: Document): void {
  if (doc.getElementById("audiobook-sync-styles")) return;
  const style = doc.createElement("style");
  style.id = "audiobook-sync-styles";
  style.textContent = `
    .${WORD_CLASS} {
      background-color: color-mix(in srgb, var(--primary, #3b82f6) 22%, transparent) !important;
      border-radius: 2px;
      box-shadow: inset 0 -2px 0 0 color-mix(in srgb, var(--primary, #3b82f6) 55%, transparent);
    }
    .${INTERP_CLASS} {
      background-color: color-mix(in srgb, var(--primary, #3b82f6) 12%, transparent) !important;
    }
    .${SENTENCE_CLASS} {
      background-color: color-mix(in srgb, var(--primary, #3b82f6) 8%, transparent) !important;
      border-radius: 2px;
    }
  `;
  doc.head?.appendChild(style);
}

export function highlightWordAtOffset(
  iframeDoc: Document,
  charOffset: number,
  wordLength: number,
  interpolated = false,
): boolean {
  const body = iframeDoc.body;
  if (!body) return false;

  injectStyles(iframeDoc);
  unwrapHighlightSpans(iframeDoc);

  const { chars } = getCachedIndex(body);
  const startChars = chars.filter((c) => c.normIndex >= charOffset && c.normIndex < charOffset + wordLength);
  if (startChars.length === 0) return false;

  const ranges = new Map<Text, { start: number; end: number }>();
  for (const c of startChars) {
    const existing = ranges.get(c.node);
    if (!existing) ranges.set(c.node, { start: c.offset, end: c.offset + 1 });
    else existing.end = c.offset + 1;
  }

  const className = interpolated ? `${WORD_CLASS} ${INTERP_CLASS}` : WORD_CLASS;
  const created: HTMLElement[] = [];
  for (const [node, range] of ranges) {
    const parent = node.parentNode;
    if (!parent) continue;
    const text = node.textContent ?? "";
    const span = iframeDoc.createElement("span");
    span.className = className;
    span.dataset.syncTap = "true";
    const frag = iframeDoc.createDocumentFragment();
    if (range.start > 0) frag.appendChild(iframeDoc.createTextNode(text.slice(0, range.start)));
    span.textContent = text.slice(range.start, range.end);
    frag.appendChild(span);
    if (range.end < text.length) frag.appendChild(iframeDoc.createTextNode(text.slice(range.end)));
    parent.replaceChild(frag, node);
    created.push(span);
  }

  previousHighlights.set(iframeDoc, created);
  invalidateIndex(body);
  return created.length > 0;
}

export function clearWordHighlight(iframeDoc: Document): void {
  clearHighlights(iframeDoc);
}

export function scrollActiveSyncWordIntoView(iframeDoc: Document): void {
  const span = iframeDoc.querySelector(`.${WORD_CLASS}`) as HTMLElement | null;
  if (!span) return;
  try {
    span.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  } catch {
    span.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

/**
 * Map a click in the EPUB iframe to a normalized char offset (for tap-to-seek).
 */
export function charOffsetFromClick(
  iframeDoc: Document,
  clientX: number,
  clientY: number,
): number | null {
  const body = iframeDoc.body;
  if (!body) return null;

  let range: Range | null = null;
  if (iframeDoc.caretRangeFromPoint) {
    range = iframeDoc.caretRangeFromPoint(clientX, clientY);
  } else {
    const docWithCaret = iframeDoc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const pos = docWithCaret.caretPositionFromPoint?.(clientX, clientY);
    if (pos) {
      range = iframeDoc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }

  if (!range || !body.contains(range.startContainer)) return null;

  const { chars } = getCachedIndex(body);
  const targetNode = range.startContainer;
  const targetOffset = range.startOffset;

  let nearest: number | null = null;
  for (const c of chars) {
    if (c.node === targetNode) {
      if (c.offset <= targetOffset) nearest = c.normIndex;
      else if (nearest !== null) break;
    }
  }
  return nearest;
}
