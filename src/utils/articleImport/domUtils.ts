/**
 * DOM helpers for the article import pipeline: parsing, deep cloning,
 * whitespace normalization, and candidate statistics.
 */

import type { CandidateStats } from './types';

/** Parse HTML into a fresh, inert Document (scripts do not execute in
 * DOMParser documents — that inertness is the pipeline's first defense). */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Deep clone via serialize+reparse — the only clone that is guaranteed to be
 * identical across engines (both extraction libraries mutate their input, so
 * each gets its own fully independent copy of the source). */
export function deepCloneDocument(doc: Document): Document {
  return parseHtml(doc.documentElement.outerHTML);
}

/** Collapse runs of whitespace into single spaces and trim. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Wrap candidate HTML in a detached container for structural inspection. */
export function parseFragment(html: string): HTMLElement {
  const doc = parseHtml(`<body>${html}</body>`);
  const container = doc.createElement('div');
  while (doc.body.firstChild) {
    container.appendChild(doc.body.firstChild);
  }
  return container;
}

/** The candidate's visible, whitespace-normalized text. */
export function visibleText(root: Element | Document): string {
  return normalizeWhitespace(root.textContent ?? '');
}

/** Structural stats for a candidate subtree (pure counts, no I/O). */
export function computeStats(root: Element): CandidateStats {
  const text = visibleText(root);
  const paragraphs = Array.from(root.querySelectorAll('p'))
    .filter((p) => normalizeWhitespace(p.textContent ?? '').length > 0)
    .length;
  const images = root.querySelectorAll('img').length;
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6').length;
  let linkChars = 0;
  root.querySelectorAll('a[href]').forEach((a) => {
    linkChars += normalizeWhitespace(a.textContent ?? '').length;
  });
  return {
    words: countWords(text),
    paragraphs,
    images,
    headings,
    linkChars,
  };
}

export function cloneElement(el: Element): Element {
  return el.cloneNode(true) as Element;
}

/** Serialize an element's children as HTML (no wrapper element). */
export function innerHtml(el: Element): string {
  return el.innerHTML;
}

/**
 * Isolate the MediaWiki article region (`.mw-parser-output`, falling back to
 * `#mw-content-text`) and strip wiki chrome. Generic platform handling —
 * the same convention the legacy render-repair path (`processHtmlContent`)
 * has used for years — applied to extraction clones so every engine sees
 * the article region. Returns true when the document was MediaWiki-shaped.
 */
export function isolateMediaWikiArticle(doc: Document): boolean {
  const output = doc.querySelector('.mw-parser-output') ?? doc.querySelector('#mw-content-text');
  if (!output) return false;
  const article = output.cloneNode(true) as Element;
  article.querySelectorAll(
    '.mw-editsection, .mw-jump-link, .navbox, .metadata, .sistersitebox, .catlinks, .printfooter, .mw-indicators, .vector-page-toolbar, .reflist, .mw-references-wrap'
  ).forEach((el) => el.remove());
  if (!doc.body) return false;
  doc.body.replaceChildren(article);
  return true;
}
