/**
 * Fetch transport for the article import pipeline.
 *
 * Tauri (desktop + Android): the Rust `fetch_url_content` command — no CORS,
 * SSRF-guarded, redirect-resolved, size-capped. Browser/PWA: direct fetch
 * with the existing CORS-proxy fallbacks (same list as the legacy importer).
 * Failures are mapped onto the typed ArticleImportError taxonomy.
 */

import { isTauri } from '../../lib/tauri';
import { fetchUrlContent, readDocumentFile } from '../../api/documents';
import { ArticleImportError } from './errors';
import { MAX_REDIRECT_HOPS } from './extractor-config';
import type { StageTimer } from './stageTimer';

export interface FetchedArticle {
  html: string;
  finalUrl: string;
  status: number;
  contentType: string;
  redirectHops: number;
  /** Temp-file path holding the raw bytes (Tauri mode) — the snapshot
   * command reads this file directly, keeping MBs off the IPC. */
  rawFilePath?: string;
}

const CORS_PROXIES = [
  null, // Try direct first
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
];

/** Fetch via the Rust backend (SSRF guard + redirect + size caps live there). */
async function fetchViaBackend(url: string, timer: StageTimer): Promise<FetchedArticle> {
  const start = performance.now();
  try {
    const fetched = await fetchUrlContent(url);
    const bytes = await readDocumentFile(fetched.file_path);
    const html = new TextDecoder('utf-8').decode(bytes);
    return {
      html,
      finalUrl: fetched.final_url ?? url,
      status: fetched.status ?? 200,
      contentType:
        fetched.header_content_type ?? fetched.content_type ?? 'text/html',
      redirectHops: fetched.redirect_hops ?? 0,
      rawFilePath: fetched.file_path,
    };
  } catch (err) {
    throw mapTransportError(err);
  } finally {
    timer.mark('fetch', start);
  }
}

/** Browser/PWA fetch with CORS-proxy fallbacks. */
async function fetchViaBrowser(url: string, timer: StageTimer): Promise<FetchedArticle> {
  const start = performance.now();
  let lastError: unknown = null;
  try {
    for (const proxy of CORS_PROXIES) {
      const fetchUrl = proxy ? proxy + encodeURIComponent(url) : url;
      try {
        const response = await fetch(fetchUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (response.status === 401 || response.status === 403) {
          throw new ArticleImportError('auth_required', undefined, {
            cause: `HTTP ${response.status}`,
          });
        }
        if (!response.ok) {
          throw new ArticleImportError('http_error', undefined, {
            cause: `HTTP ${response.status} ${response.statusText}`,
          });
        }
        const html = await response.text();
        if (html.length < 100) {
          throw new ArticleImportError('empty_content', undefined, {
            cause: 'response under 100 bytes',
          });
        }
        return {
          html,
          finalUrl: url, // CORS proxies hide redirect info; original stands in
          status: response.status,
          contentType: response.headers.get('content-type') ?? 'text/html',
          redirectHops: 0,
        };
      } catch (err) {
        if (err instanceof ArticleImportError && err.code === 'auth_required') throw err;
        lastError = err;
      }
    }
    throw mapTransportError(lastError);
  } finally {
    timer.mark('fetch', start);
  }
}

export function mapTransportError(err: unknown): ArticleImportError {
  if (err instanceof ArticleImportError) return err;
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/HTTP (401|403)/i.test(message)) {
    return new ArticleImportError('auth_required', undefined, { cause: err });
  }
  if (/RESPONSE_TOO_LARGE/i.test(message)) {
    return new ArticleImportError('http_error', 'The page is too large to import (limit 15 MB).', {
      cause: err,
      retriable: false,
    });
  }
  if (/too many redirects/i.test(message)) {
    return new ArticleImportError('network_failed', 'The address redirects in a loop.', {
      cause: err,
      retriable: false,
    });
  }
  if (/HTTP \d{3}/i.test(message)) {
    return new ArticleImportError('http_error', undefined, { cause: err });
  }
  return new ArticleImportError('network_failed', undefined, { cause: err });
}

/** Fetch the article source. Redirect-hop sanity is enforced client-side too
 * (defense in depth for the proxy path). */
export async function fetchArticleSource(
  url: string,
  timer: StageTimer,
  signal?: AbortSignal
): Promise<FetchedArticle> {
  if (signal?.aborted) throw new ArticleImportError('canceled');
  const result = isTauri()
    ? await fetchViaBackend(url, timer)
    : await fetchViaBrowser(url, timer);
  if (signal?.aborted) throw new ArticleImportError('canceled');
  if (result.redirectHops > MAX_REDIRECT_HOPS) {
    throw new ArticleImportError('network_failed', 'The address redirects in a loop.', {
      retriable: false,
    });
  }
  if (result.html.trim().length === 0) {
    throw new ArticleImportError('empty_content');
  }
  return result;
}
