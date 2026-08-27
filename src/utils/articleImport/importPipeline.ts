/**
 * The canonical Web Article Import Pipeline (design D1–D11).
 *
 * importArticle(url): normalize → fetch → parse → metadata → site-specific +
 * Defuddle + Readability on independent clones → score → rendered-page
 * fallback when static confidence is insufficient → normalize → sanitize →
 * degeneracy check → NormalizedArticle + diagnostics. Every stage is timed,
 * every failure maps onto the typed taxonomy, and AbortSignal cancellation is
 * honored between stages.
 */

import {
  ACCEPT_FLOOR,
  CANDIDATE_DIAGNOSTICS_LIMIT,
  EMERGENCY_ACCEPT_FLOOR,
  EMERGENCY_MIN_WORDS,
  MIN_WORDS,
  SANITIZE_FAIL_RATIO,
  SANITIZE_WARN_RATIO,
} from './extractor-config';
import {
  ArticleImportError,
  throwIfAborted,
  toArticleImportError,
} from './errors';
import {
  countWords,
  deepCloneDocument,
  isolateMediaWikiArticle,
  normalizeWhitespace,
  parseHtml,
} from './domUtils';
import { fetchArticleSource } from './fetchClient';
import { extractPageMetadata, resolveArticleMetadata } from './metadataExtractor';
import { runDefuddle } from './engines/defuddleExtractor';
import { runReadability } from './engines/readabilityExtractor';
import { siteSpecificExtractorFor } from './engines/site-specific';
import { runSemanticExtraction } from './engines/semanticExtractor';
import { scoreCandidate, selectBestCandidate } from './scorer';
import { normalizeArticle } from './articleNormalizer';
import { normalizeImages } from './imageNormalizer';
import { sanitizeArticleHtml } from './sanitizer';
import { ingestArticleAssets } from './articleAssetIngestor';
import {
  docBaseHref,
  resolveEffectiveResourceBase,
  stripBaseElements,
} from './resourceBase';
import { getRenderedCapture, RenderedCaptureError } from './renderedFallback/captureClient';
import { siteNameFromUrl } from './urlNormalizer';
import { resolveImportSource } from './arxivResolver';
import { createStageTimer } from './stageTimer';
import type {
  ArticleImportDiagnostics,
  CandidateDiagnostic,
  ExtractionCandidate,
  NormalizedArticle,
  ScoredCandidate,
  ImportArticleOptions,
  PageMetadata,
} from './types';

export interface ArticleImportOutcome {
  article: NormalizedArticle;
  diagnostics: ArticleImportDiagnostics;
  /** Verbatim fetched HTML (pre-pipeline) for the raw-source snapshot. */
  rawHtml: string;
  /** Temp file holding the raw bytes in Tauri mode (snapshot input). */
  rawFilePath?: string;
  resolvedUrl: string;
  canonicalUrl: string;
  normalizedOriginalUrl: string;
}

/** Canonical URL precedence (design D4): canonical link → JSON-LD url → og:url
 * → final redirect-resolved URL → normalized original. */
export function resolveCanonicalUrl(
  meta: PageMetadata,
  resolvedUrl: string,
  normalizedOriginal: string
): string {
  const absolutize = (candidate: string | undefined): string | undefined => {
    if (!candidate) return undefined;
    try {
      return new URL(candidate, resolvedUrl).toString();
    } catch {
      return undefined;
    }
  };
  return (
    absolutize(meta.canonicalLink) ??
    absolutize(meta.jsonLdUrl) ??
    absolutize(meta.ogUrl) ??
    resolvedUrl ??
    normalizedOriginal
  );
}

function candidateDiagnostic(scored: ScoredCandidate): CandidateDiagnostic {
  return {
    engine: scored.candidate.engine,
    score: scored.score,
    confidence: scored.confidence,
    words: scored.candidate.stats.words,
    paragraphs: scored.candidate.stats.paragraphs,
    images: scored.candidate.stats.images,
  };
}

/** Prepare a clone for an engine: resolve lazy-load/srcset images to a
 * single absolute URL against the CANONICAL base BEFORE the engine parses
 * it. Engines strip data-* attributes and resolve relative URLs against
 * whatever base they infer; doing it first means every candidate carries
 * correct absolute image URLs regardless of which engine wins. */
function cloneForEngine(doc: Document, url: string): Document {
  const clone = deepCloneDocument(doc);
  isolateMediaWikiArticle(clone);
  if (clone.body) {
    normalizeImages(clone.body, url);
  }
  return clone;
}

async function runExtractionChain(
  doc: Document,
  url: string,
  timer: { mark: (stage: 'defuddle' | 'readability' | 'extraction', start: number) => number },
  enginePrefix = ''
): Promise<ExtractionCandidate[]> {
  const candidates: ExtractionCandidate[] = [];

  const siteExtractor = siteSpecificExtractorFor(url);
  if (siteExtractor) {
    try {
      const candidate = siteExtractor(cloneForEngine(doc, url), url);
      if (candidate) candidates.push(candidate);
    } catch {
      // Site-specific failure degrades to the generic engines.
    }
  }

  if (!enginePrefix) {
    try {
      const semanticResult = runSemanticExtraction(cloneForEngine(doc, url));
      if (semanticResult) candidates.push(semanticResult);
    } catch {
      // Semantic failure degrades silently.
    }
  }

  const defuddleStart = performance.now();
  const defuddleResult = await runDefuddle(cloneForEngine(doc, url), url);
  timer.mark('defuddle', defuddleStart);
  if (defuddleResult) {
    candidates.push(
      enginePrefix ? { ...defuddleResult, engine: `${enginePrefix}defuddle` } : defuddleResult
    );
  }

  const readabilityStart = performance.now();
  const readabilityResult = await runReadability(cloneForEngine(doc, url));
  timer.mark('readability', readabilityStart);
  if (readabilityResult) {
    candidates.push(
      enginePrefix
        ? { ...readabilityResult, engine: `${enginePrefix}readability` }
        : readabilityResult
    );
  }

  return candidates;
}

function needsRenderedFallback(best: ScoredCandidate | null, totalCandidates: number): boolean {
  if (totalCandidates === 0 || !best) return true;
  return best.confidence === 'low' || best.candidate.stats.words < MIN_WORDS;
}

function isEmergencyUsable(best: ScoredCandidate | null): boolean {
  if (!best) return false;
  return (
    best.candidate.stats.words >= EMERGENCY_MIN_WORDS && best.score >= EMERGENCY_ACCEPT_FLOOR
  );
}

/**
 * Run the article pipeline for one URL. Throws ArticleImportError on failure;
 * resolves with the normalized article + full diagnostics on success.
 */
export async function importArticle(
  url: string,
  options: ImportArticleOptions = {}
): Promise<ArticleImportOutcome> {
  const { signal, onProgress } = options;
  const timer = createStageTimer();
  const progress = (stage: Parameters<NonNullable<ImportArticleOptions['onProgress']>>[0]['stage'], detail?: string): void => {
    onProgress?.({ stage, detail });
  };

  // 1. URL normalization.
  progress('normalizing');
  const normalizeStart = performance.now();
  const { normalizeArticleUrl } = await import('./urlNormalizer');
  const normalized = normalizeArticleUrl(url);
  timer.mark('normalizeUrl', normalizeStart);
  if (!normalized.valid) {
    throw new ArticleImportError('invalid_url', normalized.error);
  }

  const source = resolveImportSource(normalized.normalized);
  const importWarnings: string[] = [];

  // 2. Fetch.
  progress('fetching');
  const fetched = await fetchArticleSource(source.fetchUrl, timer, signal);
  throwIfAborted(signal);

  // 3. Parse.
  const parseStart = performance.now();
  const doc = parseHtml(fetched.html);
  timer.mark('parse', parseStart);
  const sourceWords = countWords(normalizeWhitespace(doc.body?.textContent ?? ''));

  // 3b. Effective resource base (design D1/D2): safe doc `<base href>` →
  // final URL verbatim → requested URL. Canonical/og/JSON-LD URLs are article
  // identity, never resource bases. `<base>` elements are stripped before
  // engine extraction and persistence — engines infer their own bases and
  // persisted HTML must never depend on one.
  const baseHref = docBaseHref(doc);
  stripBaseElements(doc);
  const resourceBase = resolveEffectiveResourceBase({
    requestedUrl: source.fetchUrl,
    finalUrl: fetched.finalUrl,
    docBaseHref: baseHref,
  });
  const assetBaseUrl = resourceBase.base;

  // 4. Metadata (before the original DOM is consumed).
  const metadataStart = performance.now();
  const meta = extractPageMetadata(doc);
  timer.mark('metadata', metadataStart);

  const metadataCanonical = resolveCanonicalUrl(meta, fetched.finalUrl, normalized.normalized);
  // Canonical URL is identity-only (dedupe/provenance); never a resource base.
  const canonicalUrl = source.arxiv ? source.canonicalUrl : metadataCanonical;
  const hostname =
    source.arxiv ? 'arXiv' : (siteNameFromUrl(fetched.finalUrl) ?? siteNameFromUrl(normalized.normalized) ?? '');

  const diagnostics: ArticleImportDiagnostics = {
    originalUrl: normalized.original,
    canonicalUrl,
    resolvedUrl: fetched.finalUrl,
    sourceClassification: source.classification,
    resourceBase: { base: resourceBase.base, source: resourceBase.source },
    importWarnings,
    fetch: {
      status: fetched.status,
      contentType: fetched.contentType,
      redirectHops: fetched.redirectHops,
    },
    candidates: [],
    normalizationWarnings: [],
    timings: timer.timings(),
  };

  // 5. Competing extraction on independent clones.
  progress('extracting', 'Running extractors');
  const extractionStart = performance.now();
  let candidates = await runExtractionChain(doc, assetBaseUrl, timer);
  timer.mark('extraction', extractionStart);

  // 6. Score.
  const scoringStart = performance.now();
  const scorerContext = {
    meta,
    sourceWords,
    jsonLdArticleBodyChars: meta.jsonLdArticleBodyChars,
  };
  let scored = candidates.map((candidate) => scoreCandidate(candidate, scorerContext));
  timer.mark('scoring', scoringStart);
  throwIfAborted(signal);

  // 7. Rendered-page fallback when static confidence is insufficient.
  let best = selectBestCandidate(scored);
  const staticBestBeforeRender = best;
  let renderedFallbackUsed = false;
  let renderFallbackReason: string | undefined;
  let emergencyStaticAcceptance = false;

  if (needsRenderedFallback(best, scored.length)) {
    renderFallbackReason =
      scored.length === 0
        ? 'no static candidates'
        : best && best.candidate.stats.words < MIN_WORDS
          ? `best static candidate below ${MIN_WORDS} words`
          : 'best static confidence low';
    progress('rendered-fallback', 'Rendering the page to retry extraction');
    renderedFallbackUsed = true;

    const fallbackStart = performance.now();
    let captureError: RenderedCaptureError | null = null;
    let renderedHtml: string | null = null;
    const capture = getRenderedCapture();
    if (!capture) {
      if (isEmergencyUsable(staticBestBeforeRender)) {
        best = staticBestBeforeRender;
        renderedFallbackUsed = true;
        emergencyStaticAcceptance = true;
        importWarnings.push(
          'JavaScript rendering is unavailable on this platform; imported static article content instead.'
        );
      } else {
        throw new ArticleImportError('rendered_unavailable', undefined, {
          cause: renderFallbackReason,
          retriable: false,
        });
      }
    } else {
      try {
        const captureUrl = source.arxiv?.htmlUrl ?? canonicalUrl;
        const result = await capture.capture(captureUrl, undefined, signal);
        renderedHtml = result.html;
      } catch (err) {
        if (err instanceof RenderedCaptureError) {
          captureError = err;
        } else {
          captureError = new RenderedCaptureError('failed', String(err));
        }
      }
    }
    timer.mark('renderedFallback', fallbackStart);
    throwIfAborted(signal);

    if (renderedHtml !== null) {
      // Re-run the engines + scorer on the rendered DOM; rendered candidates
      // compete with the static pool purely by score.
      const renderedDoc = parseHtml(renderedHtml);
      stripBaseElements(renderedDoc);
      // Hydrated pages carry metadata the static shell lacked (or lied
      // about): re-extract and merge, rendered values winning where present.
      const renderedMeta = extractPageMetadata(renderedDoc);
      for (const [key, value] of Object.entries(renderedMeta)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (key === 'conflicts') continue;
        (meta as unknown as Record<string, unknown>)[key] = value;
      }
      meta.conflicts.push(...renderedMeta.conflicts);
      const renderedCandidates = await runExtractionChain(renderedDoc, assetBaseUrl, timer, 'rendered-');
      const renderedScored = renderedCandidates.map((candidate) =>
        scoreCandidate(candidate, scorerContext)
      );
      scored = [...scored, ...renderedScored];
      best = selectBestCandidate(scored);
    } else if (captureError) {
      const reason = captureError.reason;
      if (reason === 'canceled') {
        throw new ArticleImportError('canceled', undefined, { retriable: false });
      }
      if (isEmergencyUsable(staticBestBeforeRender)) {
        best = staticBestBeforeRender;
        emergencyStaticAcceptance = true;
        importWarnings.push(
          reason === 'unavailable'
            ? 'This page could not be rendered for enhancement; imported static article content instead.'
            : 'Rendered capture timed out; imported static article content instead.'
        );
      } else if (reason === 'unavailable') {
        throw new ArticleImportError('rendered_unavailable', undefined, {
          cause: renderFallbackReason,
          retriable: false,
        });
      } else {
        throw new ArticleImportError('rendered_failed', undefined, {
          cause: captureError.message ?? renderFallbackReason,
        });
      }
    }
  }

  diagnostics.candidates = scored.slice(0, CANDIDATE_DIAGNOSTICS_LIMIT).map(candidateDiagnostic);
  diagnostics.renderedFallbackUsed = renderedFallbackUsed;
  diagnostics.renderedFallbackReason = renderFallbackReason;
  diagnostics.importWarnings = importWarnings;

  // 8. Acceptance: successful execution alone is never acceptance.
  const meetsNormalFloor =
    !!best && best.candidate.stats.words >= MIN_WORDS && best.score >= ACCEPT_FLOOR;
  const meetsEmergencyFloor = emergencyStaticAcceptance && isEmergencyUsable(best);

  if (!best || best.candidate.stats.words === 0) {
    throw new ArticleImportError('empty_content');
  }
  if (!meetsNormalFloor && !meetsEmergencyFloor) {
    diagnostics.failureReason = 'low_confidence';
    throw new ArticleImportError('low_confidence', undefined, {
      cause: renderFallbackReason ?? 'no candidate cleared the acceptance floor',
      retriable: false,
    });
  }
  if (meetsEmergencyFloor && !meetsNormalFloor) {
    diagnostics.normalizationWarnings.push('imported with reduced extraction confidence');
  }

  // 9. Metadata resolution with deterministic precedence.
  const resolvedMeta = resolveArticleMetadata(meta, best.candidate, hostname);
  if (!resolvedMeta.title) {
    // Last resort: hostname as title — never persist an untitled article.
    resolvedMeta.title = hostname || normalized.normalized;
  }

  // 10. Normalize into the canonical article shape.
  progress('normalizing-article');
  const articleStart = performance.now();
  const normalizedArticleResult = normalizeArticle({
    contentHtml: best.candidate.contentHtml,
    title: resolvedMeta.title,
    dek: resolvedMeta.dek,
    authors: resolvedMeta.authors,
    publishedTime: resolvedMeta.publishedTime,
    siteName: resolvedMeta.siteName,
    language: resolvedMeta.language,
    heroImage: resolvedMeta.heroImage,
    baseUrl: assetBaseUrl,
  });
  timer.mark('articleNormalization', articleStart);
  diagnostics.normalizationWarnings.push(...normalizedArticleResult.warnings);
  diagnostics.media = {
    discovered: normalizedArticleResult.imageReport.discovered,
    absolutized: normalizedArticleResult.imageReport.absolutized,
    dropped: normalizedArticleResult.imageReport.droppedImages,
  };

  // 11. Sanitize (the security boundary).
  const sanitizeStart = performance.now();
  const sanitized = await sanitizeArticleHtml(normalizedArticleResult.article.contentHtml);
  timer.mark('sanitization', sanitizeStart);
  throwIfAborted(signal);
  diagnostics.normalizationWarnings.push(...sanitized.warnings);

  // 11b. Durable asset ingestion (optional; remote → plethora-asset://).
  const assetStart = performance.now();
  const assetOutcome = await ingestArticleAssets(sanitized.html, {
    preserveImages: options.preserveImages,
    referrerUrl: canonicalUrl,
    signal,
  });
  timer.mark('assetIngestion', assetStart);
  throwIfAborted(signal);
  diagnostics.assets = assetOutcome.diagnostics;
  if (assetOutcome.diagnostics.failed > 0) {
    diagnostics.normalizationWarnings.push(
      `${assetOutcome.diagnostics.failed} article image(s) could not be imported`
    );
  }

  const persistedHtml = assetOutcome.html;

  // 12. Degenerate-sanitization detection.
  const preText = normalizedArticleResult.article.textContent;
  const postDoc = parseHtml(persistedHtml);
  const postText = normalizeWhitespace(postDoc.body?.textContent ?? '');
  const retained = preText.length > 0 ? postText.length / preText.length : 1;
  diagnostics.sanitization = {
    droppedTags: sanitized.report.droppedTags,
    droppedAttributes: sanitized.report.droppedAttributes,
    droppedUrls: sanitized.report.droppedUrls,
    droppedImages: sanitized.report.droppedImages,
    textRetainedRatio: Math.round(retained * 1000) / 1000,
  };
  if (retained < SANITIZE_FAIL_RATIO) {
    diagnostics.failureReason = 'sanitization_degenerate';
    throw new ArticleImportError('sanitization_degenerate', undefined, {
      cause: `only ${Math.round(retained * 100)}% of text survived sanitization`,
      retriable: false,
    });
  }
  if (retained < SANITIZE_WARN_RATIO) {
    diagnostics.sanitization.warning = true;
    diagnostics.normalizationWarnings.push(
      `sanitization removed ${Math.round((1 - retained) * 100)}% of text`
    );
  }

  // 13. Final article + diagnostics.
  const finalWords = countWords(postText);
  const finalImages = postDoc.querySelectorAll('img').length;
  diagnostics.selected = {
    engine: best.candidate.engine,
    score: best.score,
    confidence: best.confidence,
    words: best.candidate.stats.words,
    paragraphs: best.candidate.stats.paragraphs,
    images: best.candidate.stats.images,
  };
  diagnostics.finalTextChars = postText.length;
  diagnostics.finalImageCount = finalImages;
  diagnostics.timings = timer.timings();

  progress('complete');

  const article: NormalizedArticle = {
    ...normalizedArticleResult.article,
    contentHtml: persistedHtml,
    textContent: postText,
    stats: {
      words: finalWords,
      images: finalImages,
      figures: postDoc.querySelectorAll('figure').length,
    },
    sanitizationWarning: diagnostics.sanitization.warning || undefined,
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

/** Re-exported for callers that need failure mapping without the pipeline. */
export { toArticleImportError };
