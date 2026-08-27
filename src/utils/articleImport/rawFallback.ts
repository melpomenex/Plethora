/**
 * "Import full page anyway" escape hatch (design D9).
 *
 * When extraction fails, the dialog may offer — never auto-invoke — storing
 * the sanitized full page. The document is marked extractor `raw-fallback`
 * and carries a visible `inc-raw-notice` banner so it is never mistaken for
 * a cleanly extracted article. The same sanitization boundary applies.
 */

import { EXTRACTOR_VERSION } from './extractor-config';
import { ArticleImportError, toArticleImportError } from './errors';
import { fetchArticleSource } from './fetchClient';
import { normalizeWhitespace, parseHtml, countWords } from './domUtils';
import { extractPageMetadata, resolveArticleMetadata } from './metadataExtractor';
import { normalizeImages } from './imageNormalizer';
import { sanitizeArticleHtml } from './sanitizer';
import {
  docBaseHref,
  resolveEffectiveResourceBase,
  stripBaseElements,
} from './resourceBase';
import { siteNameFromUrl, normalizeArticleUrl } from './urlNormalizer';
import { resolveCanonicalUrl } from './importPipeline';
import { createStageTimer } from './stageTimer';
import type { ArticleImportDiagnostics, NormalizedArticle } from './types';
import type { ArticleImportOutcome } from './importPipeline';

export async function importRawFallbackPage(
  url: string,
  options: { signal?: AbortSignal } = {}
): Promise<ArticleImportOutcome> {
  const { signal } = options;
  const timer = createStageTimer();
  const normalized = normalizeArticleUrl(url);
  if (!normalized.valid) {
    throw new ArticleImportError('invalid_url', normalized.error);
  }

  let fetched;
  try {
    fetched = await fetchArticleSource(normalized.normalized, timer, signal);
  } catch (err) {
    throw toArticleImportError(err);
  }

  const doc = parseHtml(fetched.html);
  const meta = extractPageMetadata(doc);
  const hostname = siteNameFromUrl(fetched.finalUrl) ?? '';
  const resolved = resolveArticleMetadata(meta, {}, hostname);
  const canonicalUrl = resolveCanonicalUrl(meta, fetched.finalUrl, normalized.normalized);

  // Same effective-resource-base contract as the canonical pipeline (D1):
  // doc `<base href>` → final URL → requested URL. `<base>` elements are
  // stripped before persistence; the canonical URL is identity-only.
  const baseHref = docBaseHref(doc);
  stripBaseElements(doc);
  const resourceBase = resolveEffectiveResourceBase({
    requestedUrl: normalized.normalized,
    finalUrl: fetched.finalUrl,
    docBaseHref: baseHref,
  });

  // Full page (the point of the escape hatch): body content, images
  // normalized (absolute URLs, no tracking pixels), then sanitized.
  const body = doc.createElement('div');
  while (doc.body.firstChild) {
    body.appendChild(doc.body.firstChild);
  }
  const imageReport = normalizeImages(body, resourceBase.base);

  const sanitized = await sanitizeArticleHtml(body.innerHTML);
  const postDoc = parseHtml(sanitized.html);
  const text = normalizeWhitespace(postDoc.body?.textContent ?? '');

  const notice = doc.createElement('aside');
  notice.className = 'inc-raw-notice';
  notice.textContent =
    'Imported as the full page (extraction failed). Navigation and page furniture may be present.';
  const wrapped = `<article class="inc-article inc-raw"><header>${notice.outerHTML}</header><div class="inc-body">${sanitized.html}</div></article>`;

  const article: NormalizedArticle = {
    title: resolved.title ?? hostname ?? normalized.normalized,
    byline: resolved.authors.join(', ') || undefined,
    siteName: resolved.siteName,
    publishedTime: resolved.publishedTime,
    language: resolved.language,
    heroImage: resolved.heroImage,
    contentHtml: wrapped,
    textContent: text,
    stats: {
      words: countWords(text),
      images: postDoc.querySelectorAll('img').length,
      figures: postDoc.querySelectorAll('figure').length,
    },
  };

  const diagnostics: ArticleImportDiagnostics = {
    originalUrl: normalized.original,
    canonicalUrl,
    resolvedUrl: fetched.finalUrl,
    resourceBase: { base: resourceBase.base, source: resourceBase.source },
    media: {
      discovered: imageReport.discovered,
      absolutized: imageReport.absolutized,
      dropped: imageReport.droppedImages,
    },
    fetch: {
      status: fetched.status,
      contentType: fetched.contentType,
      redirectHops: fetched.redirectHops,
    },
    candidates: [],
    selected: {
      engine: 'raw-fallback',
      score: 0,
      confidence: 'low',
      words: article.stats.words,
      paragraphs: postDoc.querySelectorAll('p').length,
      images: article.stats.images,
    },
    normalizationWarnings: [
      'raw fallback: full page stored, not an extracted article',
      `dropped ${imageReport.droppedImages} image(s) during normalization`,
    ],
    timings: timer.timings(),
  };

  return {
    article,
    diagnostics,
    rawHtml: fetched.html,
    rawFilePath: fetched.rawFilePath,
    resolvedUrl: fetched.finalUrl,
    canonicalUrl,
    normalizedOriginalUrl: normalized.normalized,
  };
}

export const RAW_FALLBACK_EXTRACTOR = 'raw-fallback';
export const RAW_FALLBACK_EXTRACTION_VERSION = EXTRACTOR_VERSION;
