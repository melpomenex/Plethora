import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArticle, type ArticleNormalizationResult } from '../articleNormalizer';
import { normalizeWhitespace, parseHtml } from '../domUtils';
import { extractArxivHtml } from '../engines/site-specific/arxiv';
import { sanitizeArticleHtml, type SanitizeResult } from '../sanitizer';
import type { ExtractionCandidate } from '../types';

const here = dirname(fileURLToPath(import.meta.url));

export const ARXIV_FIXTURE_URL = 'https://arxiv.org/html/2410.07524v1/';

export function readArticleFixture(name: string, file = 'page.html'): string {
  return readFileSync(join(here, 'fixtures', name, file), 'utf-8');
}

export interface FinalArticleFixtureResult {
  sourceDocument: Document;
  candidate: ExtractionCandidate;
  normalized: ArticleNormalizationResult;
  sanitized: SanitizeResult;
  finalDocument: Document;
}

/** Run the deterministic arXiv source through every persisted-DOM stage. */
export async function runArxivFixtureToFinalDom(): Promise<FinalArticleFixtureResult> {
  const sourceDocument = parseHtml(readArticleFixture('arxiv-html-regression'));
  const candidate = extractArxivHtml(sourceDocument, ARXIV_FIXTURE_URL);
  if (!candidate?.title) throw new Error('arXiv fixture did not produce a titled candidate');

  const normalized = normalizeArticle({
    contentHtml: candidate.contentHtml,
    title: candidate.title,
    authors: candidate.byline?.split(',').map((author) => author.trim()) ?? [],
    siteName: 'arXiv',
    baseUrl: ARXIV_FIXTURE_URL,
  });
  const sanitized = await sanitizeArticleHtml(normalized.article.contentHtml);
  const finalDocument = parseHtml(sanitized.html);
  return { sourceDocument, candidate, normalized, sanitized, finalDocument };
}

export function headingSequence(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(
    (heading) => `${heading.tagName.toLowerCase()}:${normalizeWhitespace(heading.textContent ?? '')}`
  );
}

export function textOrder(root: ParentNode, snippets: readonly string[]): number[] {
  const text = normalizeWhitespace(root.textContent ?? '');
  return snippets.map((snippet) => text.indexOf(snippet));
}

