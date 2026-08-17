/**
 * Fixture-driven regression suite for the Web Article Import Pipeline
 * (tasks 10.1–10.3).
 *
 * Runs the REAL pipeline (engines, scorer, normalizer, sanitizer) against the
 * crafted fixture corpus under ./fixtures — fetches are fulfilled from
 * fixture files and the rendered capture is a fake, so the suite is fully
 * offline (CI hermeticity). Assertions live in each fixture's expected.json.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures');

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: () => false, // browser-mode fetch path (fetchClient is mocked anyway)
    nativePlatform: () => null,
  };
});

vi.mock('../fetchClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fetchClient')>();
  return {
    ...actual,
    fetchArticleSource: (...args: unknown[]) => fetchMock(...args),
  };
});

import { importArticle } from '../importPipeline';
import { ArticleImportError } from '../errors';
import {
  RenderedCaptureError,
  setRenderedCaptureForTests,
  type RenderedDomCapture,
} from '../renderedFallback/captureClient';
import { registeredSiteDomains } from '../engines/site-specific';

interface FixtureExpectation {
  url?: string;
  expectsFailure?: string;
  title?: string;
  authors?: string[];
  publishedAtContains?: string;
  siteName?: string;
  minWords?: number;
  mustContain?: string[];
  mustNotContain?: string[];
  mustContainImageUrls?: string[];
  mustNotContainImageUrls?: string[];
  expectedExtractor?: string;
  expectedExtractorPrefix?: string;
  expectedFigureCaptions?: string[];
  minImages?: number;
  confidenceAtLeast?: 'low' | 'medium' | 'high';
  noSiteSpecific?: boolean;
  renderedFallbackRequired?: boolean;
}

interface FixtureCase {
  name: string;
  html: string;
  renderedHtml?: string;
  expected: FixtureExpectation;
  url: string;
}

function loadCases(): FixtureCase[] {
  const cases: FixtureCase[] = [];
  for (const entry of readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(FIXTURES_DIR, entry.name);
    const expectedPath = join(dir, 'expected.json');
    if (!existsSync(expectedPath)) continue;
    const expected: FixtureExpectation = JSON.parse(readFileSync(expectedPath, 'utf-8'));
    const html = readFileSync(join(dir, 'page.html'), 'utf-8');
    const renderedPath = join(dir, 'rendered.html');
    const renderedHtml = existsSync(renderedPath)
      ? readFileSync(renderedPath, 'utf-8')
      : undefined;
    cases.push({
      name: entry.name,
      html,
      renderedHtml,
      expected,
      url: expected.url ?? `https://fixture.example.com/${entry.name}/`,
    });
  }
  // Deterministic order.
  cases.sort((a, b) => a.name.localeCompare(b.name));
  return cases;
}

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;

function fakeRenderedCapture(renderedHtml: string, url: string): RenderedDomCapture {
  return {
    capture: vi.fn(async () => ({
      html: renderedHtml,
      finalUrl: url,
      durationMs: 1000,
    })),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  setRenderedCaptureForTests(null);
});

describe('article import fixture corpus', () => {
  const cases = loadCases();
  if (cases.length === 0) throw new Error('fixture corpus is empty');

  it('the corpus covers the required categories', () => {
    const names = cases.map((c) => c.name);
    for (const required of [
      'news-traditional',
      'news-wordpress',
      'motherjones-regression',
      'substack',
      'medium-style',
      'wikipedia',
      'blog',
      'docs-page',
      'heavy-navigation',
      'recommendations-repeated',
      'newsletter-cta',
      'donation-prompts',
      'embedded-modal',
      'multi-images-captions',
      'tables',
      'blockquotes',
      'code-blocks',
      'lazy-images',
      'relative-image-urls',
      'malformed-html',
      'js-rendered-shell',
      'jsonld-rich',
      'both-static-fail',
    ]) {
      expect(names, `missing fixture category: ${required}`).toContain(required);
    }
  });

  for (const fixture of cases) {
    it(`${fixture.name}: ${fixture.expected.expectsFailure ? 'fails typed' : 'extracts an article'}`, async () => {
      const { expected } = fixture;
      fetchMock.mockResolvedValue({
        html: fixture.html,
        finalUrl: fixture.url,
        status: 200,
        contentType: 'text/html',
        redirectHops: 0,
      });

      // Rendered-fallback fixtures: inject the fake capture. Static-only
      // fixtures get a fast-failing capture: if one of them unexpectedly
      // needs the fallback, the test fails immediately with a typed error
      // instead of stalling on the real (jsdom) iframe client.
      if (expected.renderedFallbackRequired || expected.expectsFailure) {
        if (fixture.renderedHtml) {
          setRenderedCaptureForTests(fakeRenderedCapture(fixture.renderedHtml, fixture.url));
        } else if (expected.expectsFailure) {
          // Static candidates fail AND the rendered DOM (the same shell)
          // yields nothing either → acceptance floor decides.
          setRenderedCaptureForTests(fakeRenderedCapture(fixture.html, fixture.url));
        }
      } else {
        setRenderedCaptureForTests({
          capture: vi.fn(async () => {
            throw new RenderedCaptureError('unavailable', 'static fixture must not need fallback');
          }),
        });
      }

      if (expected.expectsFailure) {
        const err: unknown = await importArticle(fixture.url).catch((e) => e);
        expect(err, `${fixture.name} should fail`).toBeInstanceOf(ArticleImportError);
        expect((err as ArticleImportError).code).toBe(expected.expectsFailure);
        return;
      }

      const outcome = await importArticle(fixture.url);
      const { article, diagnostics } = outcome;

      // ── Assertions from expected.json ────────────────────────────────
      if (expected.title !== undefined) {
        expect(article.title).toBe(expected.title);
      }
      if (expected.authors) {
        for (const author of expected.authors) {
          expect(article.byline ?? '').toContain(author);
        }
      }
      if (expected.publishedAtContains) {
        expect(article.publishedTime ?? '').toContain(expected.publishedAtContains);
      }
      if (expected.siteName) {
        expect(article.siteName).toBe(expected.siteName);
      }
      if (expected.minWords !== undefined) {
        expect(
          article.stats.words,
          `${fixture.name}: word count ${article.stats.words} < ${expected.minWords}`
        ).toBeGreaterThanOrEqual(expected.minWords);
      }
      for (const text of expected.mustContain ?? []) {
        expect(article.textContent, `${fixture.name} missing body text: ${text}`).toContain(text);
      }
      for (const text of expected.mustNotContain ?? []) {
        expect(
          article.textContent,
          `${fixture.name} leaked chrome text: ${text}`
        ).not.toContain(text);
      }
      for (const url of expected.mustContainImageUrls ?? []) {
        expect(article.contentHtml, `${fixture.name} missing image ${url}`).toContain(url);
      }
      for (const url of expected.mustNotContainImageUrls ?? []) {
        expect(article.contentHtml, `${fixture.name} leaked image ${url}`).not.toContain(url);
      }
      for (const caption of expected.expectedFigureCaptions ?? []) {
        expect(article.contentHtml, `${fixture.name} missing caption: ${caption}`).toContain(caption);
      }
      if (expected.minImages !== undefined) {
        expect(article.stats.images).toBeGreaterThanOrEqual(expected.minImages);
      }
      if (expected.expectedExtractor !== undefined && expected.expectedExtractor !== 'calibrate') {
        expect(diagnostics.selected?.engine).toBe(expected.expectedExtractor);
      }
      if (expected.expectedExtractorPrefix) {
        expect(diagnostics.selected?.engine).toMatch(
          new RegExp(`^${expected.expectedExtractorPrefix}`)
        );
      }
      if (expected.noSiteSpecific) {
        expect(
          diagnostics.selected?.engine.startsWith('site:'),
          `${fixture.name}: a site-specific rule fired — the regression must pass generically`
        ).toBe(false);
        expect(registeredSiteDomains()).not.toContain('motherjones.com');
      }
      if (expected.confidenceAtLeast) {
        const got = CONFIDENCE_ORDER[(diagnostics.selected?.confidence ?? 'low') as 'low'];
        expect(
          got,
          `${fixture.name}: confidence ${diagnostics.selected?.confidence} below ${expected.confidenceAtLeast}`
        ).toBeGreaterThanOrEqual(CONFIDENCE_ORDER[expected.confidenceAtLeast]);
      }
      if (expected.renderedFallbackRequired) {
        expect(diagnostics.renderedFallbackUsed).toBe(true);
      } else {
        expect(diagnostics.renderedFallbackUsed ?? false,
          `${fixture.name}: fallback must not be the default`).toBe(false);
      }
    });
  }

  it('same fixture twice → identical scores (determinism)', async () => {
    const fixture = cases.find((c) => c.name === 'news-traditional');
    if (!fixture) throw new Error('news-traditional fixture missing');
    fetchMock.mockResolvedValue({
      html: fixture.html,
      finalUrl: fixture.url,
      status: 200,
      contentType: 'text/html',
      redirectHops: 0,
    });
    const a = await importArticle(fixture.url);
    const b = await importArticle(fixture.url);
    expect(a.diagnostics.candidates).toEqual(b.diagnostics.candidates);
    expect(a.diagnostics.selected).toEqual(b.diagnostics.selected);
    expect(a.article.contentHtml).toBe(b.article.contentHtml);
  });
});
