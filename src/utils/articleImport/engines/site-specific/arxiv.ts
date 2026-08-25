/**
 * arXiv LaTeXML HTML structured extractor.
 *
 * Targets `article.ltx_document` directly instead of asking Readability to
 * guess article boundaries on a full scholarly page with nav, TOC, and MathJax.
 */

import { computeStats, deepCloneDocument, normalizeWhitespace } from '../../domUtils';
import type { ExtractionCandidate } from '../../types';

const CHROME_SELECTORS = [
  '.arxiv-html-header',
  '.ltx_page_navbar',
  '.ltx_TOC',
  '.ds-announcement',
  '.ds-site-footer',
  'header.arxiv-html-header',
  'dialog',
  'script',
  'style',
  'noscript',
].join(',');

function extractAuthors(container: ParentNode): string[] {
  const names = new Set<string>();
  container.querySelectorAll('.ltx_authors .ltx_personname').forEach((el) => {
    const name = normalizeWhitespace(el.textContent ?? '');
    if (name) names.add(name);
  });
  return [...names];
}

function unwrapLatexmlParas(root: HTMLElement): void {
  root.querySelectorAll('.ltx_para').forEach((para) => {
    const parent = para.parentNode;
    if (!parent) return;
    while (para.firstChild) {
      parent.insertBefore(para.firstChild, para);
    }
    parent.removeChild(para);
  });
}

function normalizeLatexmlTags(root: HTMLElement): void {
  root.querySelectorAll('.ltx_p').forEach((el) => {
    const p = el.ownerDocument!.createElement('p');
    p.innerHTML = el.innerHTML;
    el.replaceWith(p);
  });
  root.querySelectorAll('.ltx_title_section, .ltx_title_subsection, .ltx_title_subsubsection').forEach((el) => {
    const level = el.classList.contains('ltx_title_subsubsection')
      ? 'h4'
      : el.classList.contains('ltx_title_subsection')
        ? 'h3'
        : 'h2';
    const heading = el.ownerDocument!.createElement(level);
    heading.innerHTML = el.innerHTML;
    el.replaceWith(heading);
  });
}

function demoteAbstractHeading(root: HTMLElement): void {
  root.querySelectorAll('.ltx_abstract .ltx_title_abstract').forEach((heading) => {
    const h3 = heading.ownerDocument!.createElement('h3');
    h3.textContent = 'Abstract';
    heading.replaceWith(h3);
  });
}

function stripChrome(root: HTMLElement): void {
  root.querySelectorAll(CHROME_SELECTORS).forEach((el) => el.remove());
}

/** Extract structured paper content from an arXiv LaTeXML HTML document. */
export function extractArxivHtml(doc: Document, _url: string): ExtractionCandidate | null {
  const ltxDoc = doc.querySelector('article.ltx_document, .ltx_document');
  if (!ltxDoc) return null;

  const working = deepCloneDocument(doc);
  const ltx = working.querySelector('article.ltx_document, .ltx_document');
  if (!ltx) return null;

  const title =
    normalizeWhitespace(
      ltx.querySelector('.ltx_title_document, h1.ltx_title')?.textContent ?? ''
    ) || undefined;
  const authors = extractAuthors(ltx);

  // Build a clean body subtree from the paper container only.
  const bodyRoot = working.createElement('div');
  bodyRoot.innerHTML = ltx.innerHTML;

  stripChrome(bodyRoot);
  bodyRoot.querySelector('.ltx_title_document')?.remove();
  bodyRoot.querySelector('.ltx_authors')?.remove();

  demoteAbstractHeading(bodyRoot);
  unwrapLatexmlParas(bodyRoot);
  normalizeLatexmlTags(bodyRoot);

  const textContent = normalizeWhitespace(bodyRoot.textContent ?? '');
  if (!textContent) return null;

  const stats = computeStats(bodyRoot);

  return {
    engine: 'site:arxiv.org',
    contentHtml: bodyRoot.innerHTML,
    title,
    byline: authors.length > 0 ? authors.join(', ') : undefined,
    textContent,
    stats,
  };
}
