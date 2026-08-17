/**
 * Article normalizer (design D8): converts the winning extraction candidate
 * into the canonical Incrementum article shape.
 *
 * ```html
 * <article class="inc-article">
 *   <header>
 *     <p class="inc-publication">…site…</p>
 *     <h1 class="inc-title">…title…</h1>
 *     <p class="inc-dek">…subtitle…</p>
 *     <p class="inc-byline">Author · Date</p>
 *   </header>
 *   <figure class="inc-hero">…</figure>
 *   <div class="inc-body">…semantic content as extracted…</div>
 * </article>
 * ```
 *
 * `inc-*` classes are structural hooks for the reader, never publisher
 * styling. Reading order is preserved exactly — highlight offsets, TTS, and
 * extracts depend on stable text order.
 */

import { countWords, normalizeWhitespace, parseFragment } from './domUtils';
import { normalizeImages, absolutizeImageUrl, type ImageNormalizationReport } from './imageNormalizer';
import { titleSimilarity } from './metadataExtractor';
import type { NormalizedArticle } from './types';

export interface ArticleNormalizerInput {
  contentHtml: string;
  title: string;
  dek?: string;
  authors: string[];
  publishedTime?: string;
  siteName?: string;
  language?: string;
  /** og:image / JSON-LD image (relative URLs allowed). */
  heroImage?: string;
  /** Canonical URL — the base for every relative URL. */
  baseUrl: string;
}

export interface ArticleNormalizationResult {
  article: NormalizedArticle;
  warnings: string[];
  imageReport: ImageNormalizationReport;
}

/** Layout wrappers that contribute nothing semantic — unwrapped to children. */
const UNWRAP_TAGS = new Set(['span', 'font', 'div', 'section', 'article', 'main']);

function isLayoutWrapper(el: Element): boolean {
  if (!UNWRAP_TAGS.has(el.tagName.toLowerCase())) return false;
  // Only unwrap div/section/article/main when they carry no semantic value:
  // no class-based inc-* hook (we just created those), and unwrapping keeps
  // children in place anyway, so the check is really about never unwrapping
  // tables, lists, or figures — none of which are in UNWRAP_TAGS.
  return true;
}

function formatBylineDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Remove in-body duplicates of the title: a leading h1/he that matches the
 * resolved title (the header already carries it). */
function removeTitleDuplicates(body: HTMLElement, title: string): void {
  const headings = Array.from(body.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  for (const heading of headings) {
    const text = normalizeWhitespace(heading.textContent ?? '');
    if (!text) continue;
    if (titleSimilarity(text, title) >= 0.85) {
      heading.remove();
      break; // only the first match — later same-text headings may be section titles
    }
  }
  // Engines sometimes leave the title as a bare paragraph (often trailing).
  body.querySelectorAll('p').forEach((p) => {
    const text = normalizeWhitespace(p.textContent ?? '');
    if (text && text === title) p.remove();
  });
}

/** Exactly one h1 (the header's inc-title); any body h1 is demoted to h2. */
function demoteBodyH1s(body: HTMLElement): void {
  body.querySelectorAll('h1').forEach((h1) => {
    const h2 = h1.ownerDocument!.createElement('h2');
    h2.innerHTML = h1.innerHTML;
    h1.replaceWith(h2);
  });
}

function removeEmptyNodes(body: HTMLElement): void {
  // Paragraphs and headings with no visible text.
  body.querySelectorAll('p, h2, h3, h4, h5, h6, li').forEach((el) => {
    const text = normalizeWhitespace(el.textContent ?? '');
    const hasMedia = el.querySelector('img, figure, audio, video');
    if (!text && !hasMedia) el.remove();
  });
  // Figures with neither image nor caption text.
  body.querySelectorAll('figure').forEach((figure) => {
    const hasImage = figure.querySelector('img') !== null;
    const caption = normalizeWhitespace(figure.querySelector('figcaption')?.textContent ?? '');
    if (!hasImage && !caption) figure.remove();
  });
}

function unwrapLayoutNodes(body: HTMLElement): void {
  // Walk repeatedly until stable: unwrapping can surface new wrappers.
  let changed = true;
  let guard = 0;
  while (changed && guard < 10) {
    changed = false;
    guard += 1;
    for (const el of Array.from(body.querySelectorAll<HTMLElement>('*'))) {
      if (el === body) continue;
      if (isLayoutWrapper(el) && !el.classList.contains('inc-body')) {
        const parent = el.parentNode;
        if (!parent) continue;
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
        changed = true;
      }
    }
  }
}

/** Normalize the winning candidate into the canonical article. */
export function normalizeArticle(input: ArticleNormalizerInput): ArticleNormalizationResult {
  const warnings: string[] = [];
  const body = parseFragment(input.contentHtml);

  // Images first (before unwrapping so figure/figcaption pairing is intact).
  const imageReport = normalizeImages(body, input.baseUrl);
  if (imageReport.droppedImages > 0) {
    warnings.push(`dropped ${imageReport.droppedImages} image(s): pixels/logos/repeats`);
  }

  removeTitleDuplicates(body, input.title);
  demoteBodyH1s(body);
  unwrapLayoutNodes(body);
  removeEmptyNodes(body);

  const doc = body.ownerDocument!;

  // Assemble the canonical article.
  const article = doc.createElement('article');
  article.className = 'inc-article';

  const header = doc.createElement('header');
  if (input.siteName) {
    const publication = doc.createElement('p');
    publication.className = 'inc-publication';
    publication.textContent = input.siteName;
    header.appendChild(publication);
  }
  const h1 = doc.createElement('h1');
  h1.className = 'inc-title';
  h1.textContent = input.title;
  header.appendChild(h1);
  if (input.dek) {
    const dek = doc.createElement('p');
    dek.className = 'inc-dek';
    dek.textContent = input.dek;
    header.appendChild(dek);
  }
  const bylineBits: string[] = [];
  if (input.authors.length > 0) bylineBits.push(input.authors.join(', '));
  if (input.publishedTime) bylineBits.push(formatBylineDate(input.publishedTime));
  if (bylineBits.length > 0) {
    const byline = doc.createElement('p');
    byline.className = 'inc-byline';
    byline.textContent = bylineBits.join(' · ');
    header.appendChild(byline);
  }
  article.appendChild(header);

  // Hero: promote the body's first figure when it matches the metadata hero
  // image; otherwise synthesize one from the metadata (absolutized).
  if (input.heroImage) {
    const heroUrl = absolutizeImageUrl(input.heroImage, input.baseUrl);
    const bodyFigures = Array.from(body.querySelectorAll('figure'));
    const heroFromBody = bodyFigures.find(
      (f) => f.querySelector('img')?.getAttribute('src') === heroUrl
    );
    let hero: Element;
    if (heroFromBody) {
      hero = heroFromBody.cloneNode(true) as Element;
      heroFromBody.remove();
    } else {
      hero = doc.createElement('figure');
      const img = doc.createElement('img');
      img.setAttribute('src', heroUrl);
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.setAttribute('loading', 'eager');
      img.setAttribute('decoding', 'async');
      hero.appendChild(img);
    }
    hero.classList.add('inc-hero');
    article.appendChild(hero);
  }

  const bodyDiv = doc.createElement('div');
  bodyDiv.className = 'inc-body';
  while (body.firstChild) {
    bodyDiv.appendChild(body.firstChild);
  }
  article.appendChild(bodyDiv);

  const contentHtml = article.outerHTML;
  const textContent = normalizeWhitespace(article.textContent ?? '');
  const images = article.querySelectorAll('img').length;
  const figures = article.querySelectorAll('figure').length;

  if (countWords(textContent) === 0) {
    warnings.push('normalized article has no text');
  }

  return {
    article: {
      title: input.title,
      dek: input.dek,
      byline: input.authors.join(', ') || undefined,
      siteName: input.siteName,
      publishedTime: input.publishedTime,
      language: input.language,
      heroImage: input.heroImage ? absolutizeImageUrl(input.heroImage, input.baseUrl) : undefined,
      contentHtml,
      textContent,
      stats: {
        words: countWords(textContent),
        images,
        figures,
      },
    },
    warnings,
    imageReport,
  };
}
