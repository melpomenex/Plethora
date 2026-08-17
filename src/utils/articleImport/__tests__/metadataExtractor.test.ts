import { describe, expect, it } from 'vitest';

import {
  cleanDocumentTitle,
  extractPageMetadata,
  resolveArticleMetadata,
  titleSimilarity,
} from '../metadataExtractor';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const BASE_PAGE = (body: string, head = '') => `
<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;

describe('extractPageMetadata', () => {
  it('reads OpenGraph, Twitter, meta author, canonical, and html lang', () => {
    const doc = parse(
      BASE_PAGE(
        '<article><h1>Story</h1><p>Body.</p></article>',
        `
        <title>Story | The Site</title>
        <meta property="og:title" content="OG Story">
        <meta property="og:description" content="OG description">
        <meta property="og:image" content="https://cdn.example.com/img.jpg">
        <meta property="og:site_name" content="The Site">
        <meta property="og:url" content="https://example.com/canonical-og">
        <meta property="og:locale" content="en_US">
        <meta property="article:published_time" content="2026-08-15T09:00:00Z">
        <meta name="twitter:data1" content="Jane Reporter">
        <meta name="author" content="Meta Author">
        <link rel="canonical" href="https://example.com/canonical-link">
        `
      )
    );
    const meta = extractPageMetadata(doc);
    expect(meta.ogTitle).toBe('OG Story');
    expect(meta.ogSiteName).toBe('The Site');
    expect(meta.ogLocale).toBe('en_US');
    expect(meta.articlePublishedTime).toBe('2026-08-15T09:00:00Z');
    expect(meta.metaAuthor).toBe('Meta Author');
    expect(meta.canonicalLink).toBe('https://example.com/canonical-link');
    expect(meta.htmlLang).toBe('en');
    expect(meta.docTitle).toBe('Story | The Site');
    expect(meta.firstH1).toBe('Story');
  });

  it('walks JSON-LD graphs (nested @graph, @type arrays)', () => {
    const doc = parse(
      BASE_PAGE(
        '<p>body</p>',
        `
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'Organization', name: 'Not the article node' },
            {
              '@type': ['NewsArticle', 'Article'],
              headline: 'JSON-LD Headline',
              author: [{ name: 'Alpha Author' }, { name: 'Beta Author' }],
              datePublished: '2026-08-15T10:00:00Z',
              publisher: { name: 'Publisher Inc' },
              image: [{ url: 'https://cdn.example.com/a.jpg' }],
              inLanguage: 'en',
              mainEntityOfPage: { '@id': 'https://example.com/jsonld-url' },
              articleBody: 'x'.repeat(3000),
            },
          ],
        })}</script>
        `
      )
    );
    const meta = extractPageMetadata(doc);
    expect(meta.jsonLdHeadline).toBe('JSON-LD Headline');
    expect(meta.jsonLdAuthors).toEqual(['Alpha Author', 'Beta Author']);
    expect(meta.jsonLdDatePublished).toBe('2026-08-15T10:00:00Z');
    expect(meta.jsonLdPublisher).toBe('Publisher Inc');
    expect(meta.jsonLdImage).toBe('https://cdn.example.com/a.jpg');
    expect(meta.jsonLdLanguage).toBe('en');
    expect(meta.jsonLdUrl).toBe('https://example.com/jsonld-url');
    expect(meta.jsonLdArticleBodyChars).toBeGreaterThan(2000);
  });

  it('tolerates malformed and malicious JSON-LD blocks', () => {
    const doc = parse(
      BASE_PAGE(
        '<p>body</p>',
        `
        <script type="application/ld+json">{"@type":"NewsArticle","headline":"OK One","author":[{"name":"Good Author"}]}</script>
        <script type="application/ld+json">{ this is not json </script>
        <script type="application/ld+json"></script>
        `
      )
    );
    const meta = extractPageMetadata(doc);
    expect(meta.jsonLdHeadline).toBe('OK One');
    expect(meta.jsonLdAuthors).toEqual(['Good Author']);
    expect(meta.conflicts.some((c) => c.includes('malformed'))).toBe(true);
  });

  it('records conflicts when sources disagree', () => {
    const doc = parse(
      BASE_PAGE(
        '<p>body</p>',
        `
        <meta property="og:title" content="OG Title">
        <meta property="og:site_name" content="OG Site">
        <meta name="author" content="Meta Author">
        <script type="application/ld+json">
          {"@type":"Article","headline":"JSONLD Title","author":[{"name":"JSONLD Author"}],"publisher":{"name":"Publisher Name"}}
        </script>
        `
      )
    );
    const meta = extractPageMetadata(doc);
    expect(meta.conflicts.some((c) => c.startsWith('title:'))).toBe(true);
    expect(meta.conflicts.some((c) => c.startsWith('author:'))).toBe(true);
    expect(meta.conflicts.some((c) => c.startsWith('site:'))).toBe(true);
  });

  it('handles a metadata-less page without throwing', () => {
    const doc = parse(BASE_PAGE('<p>Just a paragraph.</p>'));
    const meta = extractPageMetadata(doc);
    expect(meta.conflicts).toEqual([]);
    expect(meta.ogTitle).toBeUndefined();
    expect(meta.jsonLdAuthors).toBeUndefined();
  });
});

describe('cleanDocumentTitle', () => {
  it.each([
    ['Mother Jones story | Mother Jones', 'Mother Jones story'],
    ['A — Big Site', 'A'],
    // A long dash-separated tail is headline text, not a site suffix: kept.
    ['Simple Title — Not A Site Name That Is Extremely Long And Would Be Part Of The Headline Itself',
      'Simple Title — Not A Site Name That Is Extremely Long And Would Be Part Of The Headline Itself'],
    ['No separators here', 'No separators here'],
    ['Dash - Inside - Title - Short Site', 'Dash - Inside - Title'],
  ])('cleans %j', (input, expected) => {
    expect(cleanDocumentTitle(input)).toBe(expected);
  });
});

describe('resolveArticleMetadata precedence', () => {
  it('prefers JSON-LD author over meta author over engine byline', () => {
    const withJsonLd = extractPageMetadata(
      parse(
        BASE_PAGE('<p>body</p>', `
          <meta name="author" content="Meta Author">
          <script type="application/ld+json">{"@type":"NewsArticle","headline":"H","author":[{"name":"JSONLD Author"}]}</script>
        `)
      )
    );
    let resolved = resolveArticleMetadata(withJsonLd, { byline: 'Engine Byline' }, 'www.example.com');
    expect(resolved.authors).toEqual(['JSONLD Author']);

    const withMetaOnly = extractPageMetadata(
      parse(BASE_PAGE('<p>body</p>', '<meta name="author" content="Meta Author">'))
    );
    resolved = resolveArticleMetadata(withMetaOnly, { byline: 'Engine Byline' }, 'example.com');
    expect(resolved.authors).toEqual(['Meta Author']);

    const bare = extractPageMetadata(parse(BASE_PAGE('<p>body</p>')));
    resolved = resolveArticleMetadata(bare, { byline: 'By Engine Byline' }, 'example.com');
    expect(resolved.authors).toEqual(['Engine Byline']);
  });

  it('published precedence: JSON-LD → og article:published_time → engine', () => {
    const both = extractPageMetadata(
      parse(BASE_PAGE('<p>b</p>', `
        <meta property="article:published_time" content="2026-08-14T00:00:00Z">
        <script type="application/ld+json">{"@type":"Article","datePublished":"2026-08-15T00:00:00Z"}</script>
      `))
    );
    expect(resolveArticleMetadata(both, { publishedTime: '2026-01-01T00:00:00Z' }, 'e.com').publishedTime)
      .toBe('2026-08-15T00:00:00Z');

    const ogOnly = extractPageMetadata(
      parse(BASE_PAGE('<p>b</p>', '<meta property="article:published_time" content="2026-08-14T00:00:00Z">'))
    );
    expect(resolveArticleMetadata(ogOnly, { publishedTime: '2026-01-01T00:00:00Z' }, 'e.com').publishedTime)
      .toBe('2026-08-14T00:00:00Z');

    const none = extractPageMetadata(parse(BASE_PAGE('<p>b</p>')));
    expect(resolveArticleMetadata(none, { publishedTime: '2026-01-01T00:00:00Z' }, 'e.com').publishedTime)
      .toBe('2026-01-01T00:00:00Z');
  });

  it('site: og:site_name → JSON-LD publisher → hostname', () => {
    const og = extractPageMetadata(parse(BASE_PAGE('<p>b</p>', '<meta property="og:site_name" content="OG Site">')));
    expect(resolveArticleMetadata(og, {}, 'www.example.com').siteName).toBe('OG Site');

    const publisherOnly = extractPageMetadata(
      parse(BASE_PAGE('<p>b</p>', '<script type="application/ld+json">{"@type":"Article","publisher":{"name":"Pub"}}</script>'))
    );
    expect(resolveArticleMetadata(publisherOnly, {}, 'www.example.com').siteName).toBe('Pub');

    const bare = extractPageMetadata(parse(BASE_PAGE('<p>b</p>')));
    expect(resolveArticleMetadata(bare, {}, 'www.example.com').siteName).toBe('example.com');
  });

  it('language: inLanguage → html lang → og:locale', () => {
    const jsonLdLang = extractPageMetadata(
      parse(BASE_PAGE('<p>b</p>', '<script type="application/ld+json">{"@type":"Article","inLanguage":"fr"}</script>'))
    );
    expect(resolveArticleMetadata(jsonLdLang, {}, 'e.com').language).toBe('fr');

    const localeOnly = extractPageMetadata(
      parse('<html><head><meta property="og:locale" content="de_DE"></head><body><p>b</p></body></html>')
    );
    expect(resolveArticleMetadata(localeOnly, {}, 'e.com').language).toBe('de_DE');
  });

  it('keeps the engine title when it agrees with metadata; falls back when not', () => {
    const meta = extractPageMetadata(
      parse(BASE_PAGE('<p>b</p>', `
        <meta property="og:title" content="The Real Headline From Metadata">
        <script type="application/ld+json">{"@type":"Article","headline":"The Real Headline From Metadata"}</script>
      `))
    );
    const agreeing = resolveArticleMetadata(
      meta,
      { title: 'The Real Headline: From Metadata' },
      'e.com'
    );
    expect(agreeing.title).toBe('The Real Headline: From Metadata');

    const disagreeing = resolveArticleMetadata(meta, { title: 'Totally Unrelated Junk' }, 'e.com');
    expect(disagreeing.title).toBe('The Real Headline From Metadata');
  });

  it('title fallback chain: JSON-LD → og:title → cleaned <title> → first h1', () => {
    const doc = parse(
      BASE_PAGE(
        '<h1>Heading One</h1><p>b</p>',
        '<title>Doc Title | Site</title><meta property="og:title" content="OG Wins">'
      )
    );
    const og = extractPageMetadata(doc);
    expect(resolveArticleMetadata(og, {}, 'e.com').title).toBe('OG Wins');

    const docTitleOnly = extractPageMetadata(
      parse(BASE_PAGE('<h1>H1 Here</h1>', '<title>Doc Title | Site</title>'))
    );
    expect(resolveArticleMetadata(docTitleOnly, {}, 'e.com').title).toBe('Doc Title');

    const h1Only = extractPageMetadata(parse(BASE_PAGE('<h1>H1 Here</h1>')));
    expect(resolveArticleMetadata(h1Only, {}, 'e.com').title).toBe('H1 Here');
  });

  it('hero image prefers og:image over JSON-LD image', () => {
    const both = extractPageMetadata(
      parse(BASE_PAGE('<p>b</p>', `
        <meta property="og:image" content="https://og/img.jpg">
        <script type="application/ld+json">{"@type":"Article","image":"https://jsonld/img.jpg"}</script>
      `))
    );
    expect(resolveArticleMetadata(both, {}, 'e.com').heroImage).toBe('https://og/img.jpg');

    const jsonLdOnly = extractPageMetadata(
      parse(BASE_PAGE('<p>b</p>', '<script type="application/ld+json">{"@type":"Article","image":"https://jsonld/img.jpg"}</script>'))
    );
    expect(resolveArticleMetadata(jsonLdOnly, {}, 'e.com').heroImage).toBe('https://jsonld/img.jpg');
  });
});

describe('titleSimilarity', () => {
  it('scores identical titles at 1 and disjoint titles near 0', () => {
    expect(titleSimilarity('Same Title', 'Same Title')).toBe(1);
    expect(titleSimilarity('Alpha Beta', 'Zeta Eta')).toBeLessThan(0.2);
  });

  it('rewards containment (site-suffix variants)', () => {
    expect(titleSimilarity('My Headline', 'My Headline - The Site')).toBeGreaterThan(0.5);
  });
});
