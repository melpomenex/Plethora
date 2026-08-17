/**
 * URL normalization for the article import pipeline (design D4).
 *
 * The normalized URL is used for fetching and as the dedupe fallback key; the
 * exact original string the user shared is always preserved verbatim in
 * metadata for provenance.
 */

import { TRACKING_PARAM_EXACT, TRACKING_PARAM_PREFIXES } from './extractor-config';

export interface NormalizedUrl {
  /** The original string, untouched. */
  original: string;
  /** Normalized form: http/https only, lowercase host, no default port, no
   * fragment, tracking params stripped. Empty when the URL is unusable. */
  normalized: string;
  valid: boolean;
  error?: string;
}

function isTrackingParam(key: string): boolean {
  if (TRACKING_PARAM_EXACT.includes(key)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Validate + normalize a shared URL. Non-http(s) schemes, unparseable input,
 * and loopback/link-local hosts are rejected (the Rust fetch layer keeps its
 * own SSRF guard; this is the cheap first line).
 */
export function normalizeArticleUrl(raw: string): NormalizedUrl {
  const original = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(original);
  } catch {
    return { original, normalized: '', valid: false, error: 'Unparseable URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      original,
      normalized: '',
      valid: false,
      error: `Unsupported scheme: ${parsed.protocol}`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '[::]' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return {
      original,
      normalized: '',
      valid: false,
      error: 'Local/private addresses are not supported',
    };
  }

  parsed.hash = '';
  const keys = Array.from(parsed.searchParams.keys());
  for (const key of keys) {
    if (isTrackingParam(key)) {
      parsed.searchParams.delete(key);
    }
  }

  // new URL() already lowercases the host; drop a default port explicitly.
  if (
    (parsed.protocol === 'https:' && parsed.port === '443') ||
    (parsed.protocol === 'http:' && parsed.port === '80')
  ) {
    parsed.port = '';
  }

  return { original, normalized: parsed.toString(), valid: true };
}

/** Hostname without a leading `www.` — used for site-name fallbacks. */
export function siteNameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}
