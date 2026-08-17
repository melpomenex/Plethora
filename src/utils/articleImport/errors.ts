/**
 * Typed failure taxonomy for article import (design D9).
 *
 * Every pipeline failure surfaces as an `ArticleImportError` carrying one of
 * the `ArticleImportErrorCode` values, the underlying cause for diagnostics,
 * and whether a retry is sensible. Callers (share-sheet hook, import dialog)
 * render the code as a localized message and offer retry / open-original
 * actions — a failed import never creates a document silently.
 */

import type { ArticleImportErrorCode } from './types';

const RETRYABLE_CODES: ReadonlySet<ArticleImportErrorCode> = new Set([
  'network_failed',
  'http_error',
  'rendered_failed',
]);

export class ArticleImportError extends Error {
  readonly code: ArticleImportErrorCode;
  /** Optional cause message for diagnostics/logs (never shown raw as the only
   * message — the code is the user-facing truth). */
  readonly causeDetail?: string;
  readonly retriable: boolean;

  constructor(
    code: ArticleImportErrorCode,
    message?: string,
    options?: { cause?: unknown; retriable?: boolean }
  ) {
    super(message ?? defaultMessage(code), {
      cause: options?.cause instanceof Error ? options.cause : undefined,
    });
    this.name = 'ArticleImportError';
    this.code = code;
    this.causeDetail =
      options?.cause instanceof Error
        ? options.cause.message
        : typeof options?.cause === 'string'
          ? options.cause
          : undefined;
    this.retriable = options?.retriable ?? RETRYABLE_CODES.has(code);
  }

  /** True for failure families where "Open original" makes sense (the page
   * exists but could not be imported into a readable article). */
  get openOriginalUseful(): boolean {
    return (
      this.code === 'low_confidence' ||
      this.code === 'auth_required' ||
      this.code === 'rendered_unavailable' ||
      this.code === 'rendered_failed' ||
      this.code === 'sanitization_degenerate' ||
      this.code === 'empty_content' ||
      this.code === 'no_candidates'
    );
  }
}

function defaultMessage(code: ArticleImportErrorCode): string {
  switch (code) {
    case 'invalid_url':
      return 'This does not look like a shareable web article URL.';
    case 'network_failed':
      return 'The page could not be reached.';
    case 'http_error':
      return 'The site returned an error for this address.';
    case 'auth_required':
      return 'This page requires a login or subscription.';
    case 'empty_content':
      return 'The page returned no usable content.';
    case 'no_candidates':
      return 'No article content could be identified on this page.';
    case 'low_confidence':
      return 'The article on this page could not be extracted reliably.';
    case 'rendered_unavailable':
      return 'Rendering this page is not supported on this platform.';
    case 'rendered_failed':
      return 'The page could not be rendered for extraction.';
    case 'sanitization_degenerate':
      return 'Content was almost entirely removed during security filtering.';
    case 'canceled':
      return 'Import canceled.';
  }
}

/** Coerce an unknown thrown value into an ArticleImportError, mapping common
 * transport failures onto the taxonomy. */
export function toArticleImportError(err: unknown): ArticleImportError {
  if (err instanceof ArticleImportError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new ArticleImportError('canceled', undefined, { cause: err, retriable: false });
  }
  if (err instanceof Error) {
    const msg = err.message || '';
    if (/HTTP (401|403)/i.test(msg)) {
      return new ArticleImportError('auth_required', undefined, { cause: err });
    }
    if (/HTTP 4\d\d/i.test(msg) || /HTTP 5\d\d/i.test(msg)) {
      return new ArticleImportError('http_error', undefined, { cause: err });
    }
    return new ArticleImportError('network_failed', undefined, { cause: err });
  }
  return new ArticleImportError('network_failed', undefined, {
    cause: typeof err === 'string' ? err : undefined,
  });
}

/** Throw `canceled` when the signal has fired. Called between stages. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ArticleImportError('canceled', undefined, { retriable: false });
  }
}
