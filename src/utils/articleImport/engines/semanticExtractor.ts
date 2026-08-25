/**
 * Generic semantic-DOM extraction candidate.
 *
 * Inspects obvious document semantics (`<article>`, `<main>`, schema.org
 * Article JSON-LD `articleBody`) and returns a candidate that competes on
 * score — never auto-wins over Defuddle/Readability/site adapters.
 */

import { computeStats, normalizeWhitespace, parseFragment } from '../domUtils';
import type { ExtractionCandidate } from '../types';

const ARTICLE_TYPES = new Set([
  'article',
  'newsarticle',
  'blogposting',
  'techarticle',
  'scholarlyarticle',
  'report',
]);

function jsonLdArticleBody(doc: Document): string | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const type = String(node['@type'] ?? '').toLowerCase();
        if (!ARTICLE_TYPES.has(type)) continue;
        const body = node.articleBody ?? node.text;
        if (typeof body === 'string' && body.trim().length > 0) {
          return body;
        }
      }
    } catch {
      // Malformed JSON-LD — skip.
    }
  }
  return null;
}

function candidateFromElement(el: Element, engine: string): ExtractionCandidate | null {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, nav, header, footer, aside').forEach((n) => n.remove());
  const textContent = normalizeWhitespace(clone.textContent ?? '');
  if (!textContent) return null;
  const stats = computeStats(clone);
  return {
    engine,
    contentHtml: clone.innerHTML,
    title: clone.querySelector('h1')?.textContent?.trim(),
    textContent,
    stats,
  };
}

/** Produce a semantic-DOM candidate when structural signals exist. */
export function runSemanticExtraction(doc: Document): ExtractionCandidate | null {
  const article =
    doc.querySelector('article[itemprop="articleBody"], article[itemtype*="Article" i]') ??
    doc.querySelector('article') ??
    doc.querySelector('[role="article"]');
  if (article) {
    const fromArticle = candidateFromElement(article, 'semantic');
    if (fromArticle && fromArticle.stats.words >= 80) return fromArticle;
  }

  const main = doc.querySelector('main');
  if (main) {
    const nestedArticle = main.querySelector('article');
    if (nestedArticle) {
      const fromNested = candidateFromElement(nestedArticle, 'semantic');
      if (fromNested && fromNested.stats.words >= 80) return fromNested;
    }
    const fromMain = candidateFromElement(main, 'semantic');
    if (fromMain && fromMain.stats.words >= 120) return fromMain;
  }

  const jsonBody = jsonLdArticleBody(doc);
  if (jsonBody) {
    const body = parseFragment(`<div>${jsonBody}</div>`);
    const textContent = normalizeWhitespace(body.textContent ?? '');
    if (textContent) {
      const stats = computeStats(body);
      if (stats.words >= 80) {
        return {
          engine: 'semantic',
          contentHtml: body.innerHTML,
          textContent,
          stats,
        };
      }
    }
  }

  return null;
}
