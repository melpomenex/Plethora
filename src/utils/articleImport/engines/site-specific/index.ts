/**
 * Site-specific extractor registry (design D15).
 *
 * Escape hatch for sites where the generic pipeline reproducibly fails AND a
 * generic fix would risk other sites. A registry entry returns a standard
 * ExtractionCandidate that is scored against the generic candidates — an
 * override wins only by score, never by fiat. Entries are keyed by exact
 * registrable domain (host or any suffix of it, `www.` stripped).
 *
 * v1 ships EMPTY: MediaWiki (`.mw-parser-output`) turned out to be a
 * platform convention rather than a publisher hack — it is handled
 * generically in domUtils.isolateMediaWikiArticle (the same logic
 * `processHtmlContent` has used for years), which keeps the registry
 * pristine. The Mother Jones regression passes generically — no entry
 * exists for it, and none may be added for it.
 */

import type { ExtractionCandidate } from '../../types';
import { extractArxivHtml } from './arxiv';

export type SiteExtractor = (doc: Document, url: string) => ExtractionCandidate | null;

interface SiteRule {
  /** Matches the full host or any domain suffix (en.wikipedia.org matches
   * `w.wikipedia.org`? no — matches entries whose key is a suffix of the
   * host, e.g. key `wikipedia.org` matches `en.wikipedia.org`). */
  domain: string;
  extract: SiteExtractor;
}

const RULES: readonly SiteRule[] = [
  {
    domain: 'arxiv.org',
    extract: extractArxivHtml,
  },
];

/** Registry lookup for a URL's host — the first extractor in the chain. */
export function siteSpecificExtractorFor(url: string): SiteExtractor | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const rule of RULES) {
    if (host === rule.domain || host.endsWith(`.${rule.domain}`)) {
      return rule.extract;
    }
  }
  return null;
}

/** Test-only: list registered domains (asserts no motherjones rule exists). */
export function registeredSiteDomains(): string[] {
  return RULES.map((r) => r.domain);
}
