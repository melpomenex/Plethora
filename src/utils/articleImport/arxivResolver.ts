/**
 * arXiv URL identity resolution for the article import pipeline.
 *
 * Normalizes abs/html/pdf/bare-ID forms into a canonical paper identity and
 * rewrites fetch URLs so `/abs/` imports retrieve structured HTML instead of
 * the abstract chrome page.
 */

export interface ArxivIdentity {
  /** Base paper ID without version suffix (e.g. `2410.07524`). */
  paperId: string;
  /** Version number when present in the input (e.g. `1` from `v1`). */
  version?: number;
  sourceUrl: string;
  absUrl: string;
  htmlUrl: string;
  pdfUrl: string;
}

export type SourceClassification = 'generic' | 'arxiv';

export interface SourceResolution {
  classification: SourceClassification;
  /** URL passed to `fetchArticleSource`. */
  fetchUrl: string;
  /** Base for relative image/asset resolution (trailing slash when required). */
  assetBaseUrl: string;
  canonicalUrl: string;
  arxiv?: ArxivIdentity;
}

const ARXIV_HOST = 'arxiv.org';

/** Parse arXiv paper ID and optional version from a URL or bare ID string. */
export function parseArxivInput(input: string): ArxivIdentity | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare ID: 2410.07524, 2410.07524v1, cs.AI/0701234
  const bare = trimmed.match(/^(\d{4}\.\d+|[a-z-]+\/\d+)(v(\d+))?$/i);
  if (bare) {
    return buildIdentity(bare[1], bare[3] ? Number(bare[3]) : undefined, trimmed);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!url.hostname.replace(/^www\./, '').endsWith(ARXIV_HOST)) return null;

  const path = url.pathname;
  const patterns: Array<{ re: RegExp; group: number }> = [
    { re: /^\/abs\/(\d{4}\.\d+|[a-z-]+\/\d+)(v(\d+))?\/?$/i, group: 1 },
    { re: /^\/html\/(\d{4}\.\d+|[a-z-]+\/\d+)(v(\d+))?\/?$/i, group: 1 },
    { re: /^\/pdf\/(\d{4}\.\d+|[a-z-]+\/\d+)(v(\d+))?\.pdf$/i, group: 1 },
    { re: /^\/format\/(\d{4}\.\d+)(v(\d+))?\/?$/i, group: 1 },
  ];

  for (const { re } of patterns) {
    const m = path.match(re);
    if (m) {
      const version = m[3] ? Number(m[3]) : undefined;
      return buildIdentity(m[1], version, url.toString());
    }
  }
  return null;
}

function buildIdentity(paperId: string, version: number | undefined, sourceUrl: string): ArxivIdentity {
  const versionSuffix = version !== undefined ? `v${version}` : '';
  const idWithVersion = `${paperId}${versionSuffix}`;
  return {
    paperId,
    version,
    sourceUrl,
    absUrl: `https://arxiv.org/abs/${idWithVersion}`,
    htmlUrl: `https://arxiv.org/html/${idWithVersion}`,
    pdfUrl: `https://arxiv.org/pdf/${idWithVersion}.pdf`,
  };
}

/** Ensure arXiv HTML asset base URLs end with `/` for path-relative images. */
export function arxivHtmlAssetBase(htmlUrl: string): string {
  try {
    const u = new URL(htmlUrl);
    if (!u.pathname.endsWith('/')) {
      u.pathname += '/';
    }
    return u.toString();
  } catch {
    return htmlUrl.endsWith('/') ? htmlUrl : `${htmlUrl}/`;
  }
}

/** Paper ID with optional version suffix for download URLs. */
export function arxivPaperRef(identity: ArxivIdentity): string {
  return identity.version !== undefined ? `${identity.paperId}v${identity.version}` : identity.paperId;
}

export function isArxivUrl(url: string): boolean {
  return parseArxivInput(url) !== null;
}

/**
 * Classify a normalized article URL and produce fetch/canonical targets.
 * arXiv `/abs/` and bare IDs fetch structured HTML; `/html/` keeps HTML with
 * a corrected asset base. PDF URLs are not handled here (legacy direct-file path).
 */
export function resolveImportSource(normalizedUrl: string): SourceResolution {
  const arxiv = parseArxivInput(normalizedUrl);
  if (!arxiv) {
    return {
      classification: 'generic',
      fetchUrl: normalizedUrl,
      assetBaseUrl: normalizedUrl,
      canonicalUrl: normalizedUrl,
    };
  }

  const isPdf = normalizedUrl.includes('/pdf/') && normalizedUrl.endsWith('.pdf');
  if (isPdf) {
    return {
      classification: 'arxiv',
      fetchUrl: normalizedUrl,
      assetBaseUrl: normalizedUrl,
      canonicalUrl: arxiv.absUrl,
      arxiv,
    };
  }

  const fetchUrl = arxiv.htmlUrl;
  const assetBaseUrl = arxivHtmlAssetBase(fetchUrl);
  return {
    classification: 'arxiv',
    fetchUrl,
    assetBaseUrl,
    canonicalUrl: arxiv.absUrl,
    arxiv,
  };
}
