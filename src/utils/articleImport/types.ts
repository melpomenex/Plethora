/**
 * Core types for the canonical Web Article Import Pipeline.
 *
 * Every URL import (Android Share Sheet, PWA share target, toolbar dialog)
 * flows through this pipeline: normalize → fetch → metadata → competing
 * extraction (Defuddle + Mozilla Readability on independent DOM clones) →
 * deterministic scoring → optional rendered-page fallback → normalization →
 * sanitization → `NormalizedArticle`. See
 * openspec/changes/overhaul-web-article-import (design.md) for the full
 * contract these types encode.
 */

/** Identifier of the extractor that produced a candidate.
 * Generic engines are `'defuddle' | 'readability'`; rendered-fallback reruns
 * are prefixed `'rendered-'`; site-specific modules use `'site:<domain>'`;
 * the dialog escape hatch is `'raw-fallback'`. */
export type ExtractorEngine = string;

export type ExtractionConfidence = 'high' | 'medium' | 'low';

/** Machine-readable failure taxonomy for article import (design D9). */
export type ArticleImportErrorCode =
  | 'invalid_url'
  | 'network_failed'
  | 'http_error'
  | 'auth_required'
  | 'empty_content'
  | 'no_candidates'
  | 'low_confidence'
  | 'rendered_unavailable'
  | 'rendered_failed'
  | 'sanitization_degenerate'
  | 'canceled';

/** Structural stats computed from a candidate's DOM. Pure counts — the scorer
 * consumes these plus the text, never re-parses. */
export interface CandidateStats {
  words: number;
  paragraphs: number;
  images: number;
  headings: number;
  /** Characters of text inside anchors (link-density numerator). */
  linkChars: number;
}

/** One extraction result from one engine. Engines are handed deep clones of
 * the source document and their exceptions degrade to "no candidate", never
 * a pipeline abort. */
export interface ExtractionCandidate {
  engine: ExtractorEngine;
  /** Serialized HTML of the candidate subtree (unsanitized). */
  contentHtml: string;
  title?: string;
  byline?: string;
  publishedTime?: string;
  /** Whitespace-normalized visible text of the candidate. */
  textContent: string;
  stats: CandidateStats;
}

/** Structured metadata extracted from the original document before it is
 * discarded (design D7). Every field records where it came from so the
 * precedence resolution can log conflicts. */
export interface PageMetadata {
  /** og:title */
  ogTitle?: string;
  /** og:description */
  ogDescription?: string;
  /** og:image (absolutized later by image normalizer) */
  ogImage?: string;
  /** og:site_name */
  ogSiteName?: string;
  /** og:url */
  ogUrl?: string;
  /** og:locale */
  ogLocale?: string;
  /** article:published_time */
  articlePublishedTime?: string;
  /** article:section */
  articleSection?: string;
  /** JSON-LD headline from the best Article node */
  jsonLdHeadline?: string;
  /** JSON-LD author names (one per author entry) */
  jsonLdAuthors?: string[];
  /** JSON-LD datePublished */
  jsonLdDatePublished?: string;
  /** JSON-LD publisher.name */
  jsonLdPublisher?: string;
  /** JSON-LD image */
  jsonLdImage?: string;
  /** JSON-LD inLanguage */
  jsonLdLanguage?: string;
  /** JSON-LD url / mainEntityOfPage */
  jsonLdUrl?: string;
  /** Length of JSON-LD articleBody when present (completeness signal). */
  jsonLdArticleBodyChars?: number;
  /** twitter:data1 "by" or twitter:title fallbacks */
  twitterTitle?: string;
  twitterCreator?: string;
  /** <meta name="author"> */
  metaAuthor?: string;
  /** <meta name="description"> */
  metaDescription?: string;
  /** <html lang> */
  htmlLang?: string;
  /** <link rel="canonical"> href */
  canonicalLink?: string;
  /** Cleaned <title> text */
  docTitle?: string;
  /** First <h1> text in the document */
  firstH1?: string;
  /** Field-level conflicts seen during extraction, e.g.
   * `"title: jsonLd='A' og='B'"` — capped, diagnostics only. */
  conflicts: string[];
}

/** Result of the deterministic scorer (design D3). */
export interface ScoredCandidate {
  candidate: ExtractionCandidate;
  /** [0, 100] */
  score: number;
  confidence: ExtractionConfidence;
  /** Human-readable reason codes, e.g. `chrome_penalty`, `metadata_agreement`. */
  reasons: string[];
}

/** Rendered-DOM capture output shared by all platform clients. */
export interface RenderedCaptureResult {
  /** Full outerHTML of the rendered document (`<!doctype html><html>…`). */
  html: string;
  /** Final URL after in-WebView redirects. */
  finalUrl: string;
  /** Wall-clock duration of the capture in ms (diagnostics only). */
  durationMs: number;
}

/** The final, sanitized, canonical article the pipeline persists. */
export interface NormalizedArticle {
  title: string;
  /** Subtitle/dek when detected. */
  dek?: string;
  /** Joined author names. */
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  language?: string;
  /** Hero image absolute URL (also fed to coverImageUrl). */
  heroImage?: string;
  /** Sanitized canonical `<article>` HTML (the document's rich content). */
  contentHtml: string;
  /** Plain-text derivative used for word count / search / AI. */
  textContent: string;
  stats: {
    words: number;
    images: number;
    figures: number;
  };
  /** Sanitization lost >40% of candidate text (warning-level diagnostic). */
  sanitizationWarning?: boolean;
}

/** Per-stage wall-clock timings (ms) recorded for diagnostics. */
export interface StageTimings {
  normalizeUrl?: number;
  fetch?: number;
  parse?: number;
  metadata?: number;
  extraction?: number;
  defuddle?: number;
  readability?: number;
  scoring?: number;
  renderedFallback?: number;
  articleNormalization?: number;
  sanitization?: number;
}

/** Bounded per-candidate record persisted in metadata (max
 * `CANDIDATE_DIAGNOSTICS_LIMIT` entries). */
export interface CandidateDiagnostic {
  engine: string;
  score: number;
  confidence: string;
  words: number;
  paragraphs: number;
  images: number;
}

/** Everything the pipeline reports about one import (design D11). Bounded,
 * no page bodies — URL strings and counters only. */
export interface ArticleImportDiagnostics {
  originalUrl: string;
  canonicalUrl?: string;
  resolvedUrl?: string;
  fetch?: {
    status: number;
    contentType: string;
    redirectHops: number;
  };
  candidates: CandidateDiagnostic[];
  selected?: CandidateDiagnostic & { engine: string };
  renderedFallbackUsed?: boolean;
  renderedFallbackReason?: string;
  normalizationWarnings: string[];
  sanitization?: {
    droppedTags: number;
    droppedAttributes: number;
    droppedUrls: number;
    droppedImages: number;
    textRetainedRatio: number;
    warning?: boolean;
  };
  finalTextChars?: number;
  finalImageCount?: number;
  timings: StageTimings;
  failureReason?: ArticleImportErrorCode;
  /** Source adapter classification (universal-article-import-pipeline). */
  sourceClassification?: string;
  /** Non-blocking import warnings surfaced to users/diagnostics. */
  importWarnings?: string[];
}

/** Progress events emitted by the pipeline for UI states. */
export type ArticleImportStage =
  | 'normalizing'
  | 'fetching'
  | 'extracting'
  | 'rendered-fallback'
  | 'normalizing-article'
  | 'complete';

export interface ArticleImportProgress {
  stage: ArticleImportStage;
  /** Human-readable detail, e.g. "Running Defuddle + Readability". */
  detail?: string;
}

/** Platform capability flags injected into the pipeline. */
export interface PlatformCaptureCaps {
  /** Offscreen WebView capture available (Android/desktop). */
  native: boolean;
  /** Hidden iframe capture available (PWA best-effort). */
  iframe: boolean;
}

export interface ImportArticleOptions {
  signal?: AbortSignal;
  platformCaps?: PlatformCaptureCaps;
  /** Progress callback for UI states. */
  onProgress?: (progress: ArticleImportProgress) => void;
}
