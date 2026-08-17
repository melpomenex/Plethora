/**
 * Structured metadata extraction (design D7).
 *
 * Runs against the parsed source document before the engines get their
 * clones (and before the original DOM is dropped). Parses OpenGraph, JSON-LD
 * (schema.org Article family), Twitter card, meta author, language, and the
 * canonical link, then resolves the final article fields with a deterministic
 * precedence — conflicts are recorded, never silently discarded.
 */

import type { PageMetadata } from './types';
import { TITLE_ENGINE_KEEP } from './extractor-config';

const ARTICLE_TYPES = new Set([
  'Article',
  'NewsArticle',
  'BlogPosting',
  'TechArticle',
  'ReportageNewsArticle',
  'ScholarlyArticle',
  'SocialMediaPosting',
]);

function metaContent(doc: Document, selector: string): string | undefined {
  const el = doc.querySelector(selector);
  const content = el?.getAttribute('content')?.trim();
  return content && content.length > 0 ? content : undefined;
}

function pushConflict(meta: PageMetadata, field: string, a: string, b: string): void {
  meta.conflicts.push(`${field}: "${clip(a)}" vs "${clip(b)}"`);
}

function clip(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}

interface JsonLdNode {
  '@type'?: string | string[];
  '@graph'?: JsonLdNode[];
  headline?: string | string[];
  author?: unknown;
  datePublished?: string;
  publisher?: { name?: string } | string;
  image?: unknown;
  inLanguage?: string;
  url?: string;
  mainEntityOfPage?: unknown;
  articleBody?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim();
  }
  return asString(value);
}

function extractImage(node: JsonLdNode): string | undefined {
  const image = node.image;
  if (typeof image === 'string') return asString(image);
  if (Array.isArray(image)) {
    for (const entry of image) {
      if (typeof entry === 'string') {
        const s = asString(entry);
        if (s) return s;
      } else if (entry && typeof entry === 'object') {
        const url = asString((entry as { url?: unknown }).url);
        if (url) return url;
      }
    }
  } else if (image && typeof image === 'object') {
    return asString((image as { url?: unknown }).url);
  }
  return undefined;
}

function mainEntityUrl(node: JsonLdNode): string | undefined {
  const mep = node.mainEntityOfPage;
  if (typeof mep === 'string') return asString(mep);
  if (mep && typeof mep === 'object') {
    return asString((mep as { '@id'?: unknown; url?: unknown })['@id']) ??
      asString((mep as { url?: unknown }).url);
  }
  return undefined;
}

/** Parse every `application/ld+json` block, tolerating malformed/malicious
 * JSON (recorded as nothing — the pipeline continues on OG/meta alone). */
function collectJsonLdNodes(doc: Document): { nodes: JsonLdNode[]; malformed: number } {
  const nodes: JsonLdNode[] = [];
  let malformed = 0;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    const text = script.textContent ?? '';
    if (!text.trim()) return;
    try {
      const parsed: unknown = JSON.parse(text);
      collectNodes(parsed, nodes);
    } catch {
      malformed += 1;
    }
  });
  return { nodes, malformed };
}

function collectNodes(value: unknown, out: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectNodes(entry, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as JsonLdNode;
  if (Array.isArray(node['@graph'])) {
    for (const entry of node['@graph']) collectNodes(entry, out);
  }
  out.push(node);
}

function nodeMatchesArticleType(node: JsonLdNode): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  return types.some((t) => ARTICLE_TYPES.has(t));
}

function extractJsonLdAuthors(author: unknown): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const s = value.trim();
      if (s) out.push(s);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      const name = asString((value as { name?: unknown }).name);
      if (name) out.push(name);
    }
  };
  visit(author);
  return out;
}

/** Extract all structured metadata signals from the source document. */
export function extractPageMetadata(doc: Document, rawHtml?: string): PageMetadata {
  const meta: PageMetadata = { conflicts: [] };

  meta.ogTitle = metaContent(doc, 'meta[property="og:title"]');
  meta.ogDescription = metaContent(doc, 'meta[property="og:description"]');
  meta.ogImage = metaContent(doc, 'meta[property="og:image"]');
  meta.ogSiteName = metaContent(doc, 'meta[property="og:site_name"]');
  meta.ogUrl = metaContent(doc, 'meta[property="og:url"]');
  meta.ogLocale = metaContent(doc, 'meta[property="og:locale"]');
  meta.articlePublishedTime = metaContent(doc, 'meta[property="article:published_time"]');
  meta.articleSection = metaContent(doc, 'meta[property="article:section"]');

  meta.twitterTitle = metaContent(doc, 'meta[name="twitter:title"]');
  meta.twitterCreator =
    metaContent(doc, 'meta[name="twitter:data1"]') ??
    metaContent(doc, 'meta[property="twitter:creator"]');

  meta.metaAuthor = metaContent(doc, 'meta[name="author"]');
  meta.metaDescription = metaContent(doc, 'meta[name="description"]');
  meta.htmlLang = doc.documentElement.getAttribute('lang')?.trim() || undefined;
  meta.canonicalLink = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() ||
    undefined;
  meta.docTitle = doc.querySelector('title')?.textContent?.trim() || undefined;
  meta.firstH1 = doc.querySelector('h1')?.textContent?.trim() || undefined;

  // JSON-LD graph walk — pick the best Article-family node (deepest
  // headline/articleBody wins deterministically by field richness).
  const { nodes, malformed } = collectJsonLdNodes(doc);
  if (malformed > 0) {
    meta.conflicts.push(`jsonLd: ${malformed} malformed block(s) ignored`);
  }
  let best: JsonLdNode | undefined;
  let bestScore = -1;
  for (const node of nodes) {
    if (!nodeMatchesArticleType(node)) continue;
    let score = 0;
    if (firstString(node.headline)) score += 1;
    if (node.articleBody) score += 2;
    if (extractJsonLdAuthors(node.author).length > 0) score += 1;
    if (node.datePublished) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  if (best) {
    meta.jsonLdHeadline = firstString(best.headline);
    meta.jsonLdAuthors = extractJsonLdAuthors(best.author);
    meta.jsonLdDatePublished = asString(best.datePublished);
    meta.jsonLdPublisher =
      typeof best.publisher === 'string' ? asString(best.publisher) : asString(best.publisher?.name);
    meta.jsonLdImage = extractImage(best);
    meta.jsonLdLanguage = asString(best.inLanguage);
    meta.jsonLdUrl = asString(best.url) ?? mainEntityUrl(best);
    meta.jsonLdArticleBodyChars = best.articleBody?.length;
  }

  // Conflict diagnostics for the fields with multiple sources.
  if (meta.jsonLdHeadline && meta.ogTitle && meta.jsonLdHeadline !== meta.ogTitle) {
    pushConflict(meta, 'title', meta.jsonLdHeadline, meta.ogTitle);
  }
  if (meta.jsonLdAuthors?.length && meta.metaAuthor && !meta.jsonLdAuthors.includes(meta.metaAuthor)) {
    pushConflict(meta, 'author', meta.jsonLdAuthors.join(', '), meta.metaAuthor);
  }
  if (meta.jsonLdDatePublished && meta.articlePublishedTime && meta.jsonLdDatePublished !== meta.articlePublishedTime) {
    pushConflict(meta, 'published', meta.jsonLdDatePublished, meta.articlePublishedTime);
  }
  if (meta.ogSiteName && meta.jsonLdPublisher && meta.ogSiteName !== meta.jsonLdPublisher) {
    pushConflict(meta, 'site', meta.ogSiteName, meta.jsonLdPublisher);
  }

  // The raw-html fallback below exists because some engines strip <head>
  // content from their clones; callers pass the pristine document so this is
  // only a safety net for callers that cannot.
  if (!meta.ogTitle && rawHtml) {
    const match = rawHtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    meta.ogTitle = match?.[1]?.trim();
  }

  return meta;
}

/** Strip publisher suffixes from a <title> ("Article | Site", "Article — Site",
 * "Article - Site", "Article · Site"). Only the LAST separator is stripped and
 * only when the remaining tail is short (site names are short). */
export function cleanDocumentTitle(title: string): string {
  let cleaned = title.trim();
  // Apply once; repeated application could eat the article title itself.
  const separators = [' | ', ' — ', ' – ', ' - ', ' · ', ' :: '];
  for (const sep of separators) {
    const idx = cleaned.lastIndexOf(sep);
    if (idx > 0) {
      const head = cleaned.slice(0, idx).trim();
      const tail = cleaned.slice(idx + sep.length).trim();
      if (head.length > 0 && tail.length > 0 && tail.length <= 60) {
        cleaned = head;
      }
      break;
    }
  }
  return cleaned.trim();
}

/** Normalized-set similarity for titles: token Jaccard with substring bonus. */
export function titleSimilarity(a: string, b: string): number {
  const norm = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  const ta = norm(a);
  const tb = norm(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  const jaccard = shared / (setA.size + setB.size - shared);
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  const substringBonus = la === lb ? 0.5 : lb.includes(la) || la.includes(lb) ? 0.25 : 0;
  return Math.min(1, jaccard + substringBonus);
}

/** The metadata-precedence title (engine title validated separately). */
export function metadataPreferredTitle(meta: PageMetadata): string | undefined {
  return (
    meta.jsonLdHeadline ??
    meta.ogTitle ??
    (meta.docTitle ? cleanDocumentTitle(meta.docTitle) : undefined) ??
    meta.firstH1
  );
}

/** Final title: keep the engine-extracted title when it agrees reasonably
 * with metadata (extraction won a good score); otherwise fall back to the
 * metadata precedence chain (design D7). */
export function resolveTitle(
  engineTitle: string | undefined,
  meta: PageMetadata
): string | undefined {
  const preferred = metadataPreferredTitle(meta);
  if (engineTitle && preferred) {
    const similarity = titleSimilarity(engineTitle, preferred);
    if (similarity >= TITLE_ENGINE_KEEP) {
      // An engine title that merely echoes <title> carries the site suffix;
      // the cleaned form is the article's name.
      if (engineTitle === meta.docTitle) {
        return cleanDocumentTitle(engineTitle);
      }
      return engineTitle;
    }
  }
  return preferred ?? engineTitle;
}

export interface ResolvedArticleMetadata {
  title?: string;
  authors: string[];
  publishedTime?: string;
  siteName?: string;
  language?: string;
  description?: string;
  heroImage?: string;
  dek?: string;
}

/** Resolve every field with the deterministic D7 precedence. */
export function resolveArticleMetadata(
  meta: PageMetadata,
  engineCandidate: { title?: string; byline?: string; publishedTime?: string },
  hostname: string
): ResolvedArticleMetadata {
  const title = resolveTitle(engineCandidate.title, meta);

  const authors: string[] = [];
  if (meta.jsonLdAuthors?.length) {
    authors.push(...meta.jsonLdAuthors);
  } else if (meta.metaAuthor) {
    authors.push(meta.metaAuthor);
  } else if (engineCandidate.byline) {
    // Readability bylines sometimes carry extra decoration ("By X").
    authors.push(engineCandidate.byline.replace(/^by\s+/i, '').trim());
  }
  if (authors.length === 0 && meta.twitterCreator && !/@/.test(meta.twitterCreator)) {
    authors.push(meta.twitterCreator);
  }

  const publishedTime =
    meta.jsonLdDatePublished ??
    meta.articlePublishedTime ??
    engineCandidate.publishedTime ??
    undefined;

  const siteName = meta.ogSiteName ?? meta.jsonLdPublisher ?? hostname.replace(/^www\./, '');

  const language = meta.jsonLdLanguage ?? meta.htmlLang ?? meta.ogLocale;

  const description = meta.ogDescription ?? meta.metaDescription;

  const heroImage = meta.ogImage ?? meta.jsonLdImage;

  return { title, authors, publishedTime, siteName, language, description, heroImage };
}
