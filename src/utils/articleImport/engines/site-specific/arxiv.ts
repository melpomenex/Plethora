/**
 * arXiv LaTeXML HTML structured extractor.
 *
 * LaTeXML's classes identify useful scholarly structures, but they are also
 * publisher-controlled presentation vocabulary. This extractor maps the
 * recognized subset to semantic HTML and Plethora-owned hooks, then drops all
 * remaining source classes before the generic normalizer sees the candidate.
 */

import { computeStats, deepCloneDocument, normalizeWhitespace } from '../../domUtils';
import {
  generatedScholarlyId,
  type ScholarlyClassToken,
} from '../../scholarlyContract';
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
  'link[rel="stylesheet"]',
  'iframe',
  'object',
  'embed',
  'form',
  'svg',
].join(',');

const OWNED_HOOKS = new WeakMap<Element, ScholarlyClassToken[]>();

function extractAuthors(container: ParentNode): string[] {
  const names = new Set<string>();
  container.querySelectorAll('.ltx_authors .ltx_personname').forEach((el) => {
    const name = normalizeWhitespace(el.textContent ?? '');
    if (name) names.add(name);
  });
  return [...names];
}

function replaceTag<T extends keyof HTMLElementTagNameMap>(
  element: Element,
  tagName: T
): HTMLElementTagNameMap[T] {
  const replacement = element.ownerDocument!.createElement(tagName);
  for (const attr of Array.from(element.attributes)) {
    replacement.setAttribute(attr.name, attr.value);
  }
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.replaceWith(replacement);
  return replacement;
}

function setHook(element: Element, ...hooks: ScholarlyClassToken[]): void {
  OWNED_HOOKS.set(element, hooks);
  element.setAttribute('class', hooks.join(' '));
}

/**
 * Remap only source identifiers participating in a same-document link pair.
 * Targets are numbered in document order, so source spelling cannot influence
 * the canonical identifier.
 */
function remapReferencedFragments(root: HTMLElement): void {
  const referenced = new Set<string>();
  root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    const sourceId = anchor.getAttribute('href')!.slice(1);
    if (sourceId) referenced.add(sourceId);
  });

  const remapped = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('[id]').forEach((target) => {
    const sourceId = target.id;
    if (!referenced.has(sourceId)) return;
    const generated = generatedScholarlyId(remapped.size + 1);
    remapped.set(sourceId, generated);
    target.id = generated;
  });

  root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    const generated = remapped.get(anchor.getAttribute('href')!.slice(1));
    if (generated) anchor.setAttribute('href', `#${generated}`);
    else anchor.removeAttribute('href');
  });

  root.querySelectorAll<HTMLElement>('[id]').forEach((target) => {
    if (!target.id.startsWith('inc-ref-')) target.removeAttribute('id');
  });
}

function unwrapLatexmlParas(root: HTMLElement): void {
  root.querySelectorAll('.ltx_para').forEach((para) => {
    const parent = para.parentNode;
    if (!parent) return;
    while (para.firstChild) parent.insertBefore(para.firstChild, para);
    parent.removeChild(para);
  });
}

function normalizeParagraphsAndHeadings(root: HTMLElement): void {
  root.querySelectorAll('.ltx_p').forEach((element) => {
    if (element.tagName.toLowerCase() !== 'p') replaceTag(element, 'p');
  });

  root
    .querySelectorAll('.ltx_title_section, .ltx_title_subsection, .ltx_title_subsubsection')
    .forEach((element) => {
      const level = element.classList.contains('ltx_title_subsubsection')
        ? 'h4'
        : element.classList.contains('ltx_title_subsection')
          ? 'h3'
          : 'h2';
      if (element.tagName.toLowerCase() !== level) replaceTag(element, level);
    });
}

function normalizeAbstract(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.ltx_abstract').forEach((source) => {
    const section =
      source.tagName.toLowerCase() === 'section' ? source : replaceTag(source, 'section');
    setHook(section, 'inc-abstract');
    const headings = Array.from(section.querySelectorAll('.ltx_title_abstract'));
    const first = headings.shift();
    if (first) {
      const heading = first.tagName.toLowerCase() === 'h2' ? first : replaceTag(first, 'h2');
      heading.textContent = 'Abstract';
      headings.forEach((duplicate) => duplicate.remove());
    } else {
      const heading = section.ownerDocument!.createElement('h2');
      heading.textContent = 'Abstract';
      section.prepend(heading);
    }
  });
}

function normalizeMath(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('math[alttext]').forEach((math) => {
    const alt = normalizeWhitespace(math.getAttribute('alttext') ?? '');
    math.removeAttribute('alttext');
    if (alt) math.setAttribute('aria-label', alt.slice(0, 500));
  });

  root.querySelectorAll<HTMLElement>('.ltx_equationgroup').forEach((group) => {
    const container = group.tagName.toLowerCase() === 'div' ? group : replaceTag(group, 'div');
    setHook(container, 'inc-equation-group');
  });
  root.querySelectorAll<HTMLElement>('.ltx_equation').forEach((source) => {
    const equation = source.tagName.toLowerCase() === 'div' ? source : replaceTag(source, 'div');
    setHook(equation, 'inc-equation', 'inc-wide');
    equation.setAttribute('aria-label', 'Scrollable equation');
  });
  root.querySelectorAll<HTMLElement>('.ltx_tag_equation').forEach((number) => {
    setHook(number, 'inc-equation-number');
  });
}

function normalizeTheorems(root: HTMLElement): void {
  root
    .querySelectorAll<HTMLElement>('.ltx_theorem, .ltx_theorem_theorem, .ltx_theorem_proof, .ltx_proof')
    .forEach((source) => {
      const isProof =
        source.classList.contains('ltx_theorem_proof') ||
        source.classList.contains('ltx_proof');
      const section =
        source.tagName.toLowerCase() === 'section' ? source : replaceTag(source, 'section');
      setHook(section, isProof ? 'inc-proof' : 'inc-theorem');
      const title = section.querySelector<HTMLElement>(':scope > .ltx_title, :scope > h6');
      if (title) {
        const paragraph = title.tagName.toLowerCase() === 'p' ? title : replaceTag(title, 'p');
        setHook(paragraph, isProof ? 'inc-proof-title' : 'inc-theorem-title');
      }
    });
}

function normalizeTables(root: HTMLElement): void {
  root.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
    if (table.parentElement?.classList.contains('inc-table-wrap')) return;
    const wrapper = table.ownerDocument!.createElement('div');
    setHook(wrapper, 'inc-table-wrap', 'inc-wide');
    wrapper.setAttribute('aria-label', 'Scrollable table');
    table.before(wrapper);
    wrapper.appendChild(table);
  });
}

function normalizeReferences(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.ltx_bibliography').forEach((source) => {
    const section =
      source.tagName.toLowerCase() === 'section' ? source : replaceTag(source, 'section');
    setHook(section, 'inc-bibliography');
  });
  root.querySelectorAll<HTMLElement>('.ltx_bibitem').forEach((item) => {
    setHook(item, 'inc-reference');
  });
  root.querySelectorAll<HTMLElement>('.ltx_cite').forEach((source) => {
    const cite = source.tagName.toLowerCase() === 'cite' ? source : replaceTag(source, 'cite');
    setHook(cite, 'inc-citation');
  });

  root.querySelectorAll<HTMLElement>('.ltx_notes').forEach((source) => {
    const section =
      source.tagName.toLowerCase() === 'section' ? source : replaceTag(source, 'section');
    setHook(section, 'inc-footnotes');
  });
  root.querySelectorAll<HTMLElement>('.ltx_note_outer').forEach((note) => {
    setHook(note, 'inc-footnote');
  });
  root.querySelectorAll<HTMLElement>('.ltx_note_mark').forEach((mark) => {
    const inNote = mark.closest('.inc-footnote') !== null;
    if (mark.tagName.toLowerCase() === 'a' && inNote) {
      setHook(mark, 'inc-footnote-backref');
      return;
    }
    const ref = mark.tagName.toLowerCase() === 'sup' ? mark : replaceTag(mark, 'sup');
    setHook(ref, 'inc-footnote-ref');
  });
}

function stripPublisherPresentation(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const ownedHooks = OWNED_HOOKS.get(element);
    if (ownedHooks?.length) element.className = ownedHooks.join(' ');
    else element.removeAttribute('class');
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name === 'style' ||
        name === 'alttext' ||
        name.startsWith('on') ||
        name.startsWith('data-')
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

function stripChrome(root: HTMLElement): void {
  root.querySelectorAll(CHROME_SELECTORS).forEach((element) => element.remove());
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

  const bodyRoot = working.createElement('div');
  bodyRoot.innerHTML = ltx.innerHTML;

  stripChrome(bodyRoot);
  bodyRoot.querySelector('.ltx_title_document')?.remove();
  bodyRoot.querySelector('.ltx_authors')?.remove();

  // Relationships are captured while source IDs/classes still exist.
  remapReferencedFragments(bodyRoot);
  normalizeAbstract(bodyRoot);
  normalizeParagraphsAndHeadings(bodyRoot);
  normalizeMath(bodyRoot);
  normalizeTheorems(bodyRoot);
  normalizeTables(bodyRoot);
  normalizeReferences(bodyRoot);
  unwrapLatexmlParas(bodyRoot);
  stripPublisherPresentation(bodyRoot);

  const textContent = normalizeWhitespace(bodyRoot.textContent ?? '');
  if (!textContent) return null;

  return {
    engine: 'site:arxiv.org',
    contentHtml: bodyRoot.innerHTML,
    title,
    byline: authors.length > 0 ? authors.join(', ') : undefined,
    textContent,
    stats: computeStats(bodyRoot),
  };
}
