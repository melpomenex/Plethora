/**
 * End-to-end resource-resolution chain test (task 2.3,
 * fix-imported-html-resource-resolution): the exact ArXiv sequence —
 * fetch URL → parse → effective resource base → image normalization →
 * article normalization → sanitization → persisted src values — plus the
 * design-D7 persistence scan: persisted canonical HTML contains ZERO
 * relative or scheme-relative media src and no <base> dependency.
 *
 * Hermetic: fetches are fulfilled from the regression fixture, the asset
 * ingestor is an identity stub (ingestion has its own suite), and the
 * rendered capture is never reached.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: () => false,
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

// Identity stub: this suite asserts extraction-time URL resolution, not the
// registry. Ingestion (incl. failure degradation) has its own suite.
vi.mock('../articleAssetIngestor', () => ({
  ingestArticleAssets: async (html: string) => ({
    html,
    diagnostics: {
      discovered: 0, imported: 0, reused: 0, failed: 0, rejected: 0,
      degradedToRemote: 0, totalBytes: 0, assetIds: [], failures: [],
    },
  }),
}));

import { importArticle } from '../importPipeline';
import { setRenderedCaptureForTests } from '../renderedFallback/captureClient';
import { RenderedCaptureError } from '../renderedFallback/captureClient';

const ARXIV_PAGE = readFileSync(
  join(here, 'fixtures/arxiv-html-regression/page.html'),
  'utf-8'
);

/** Design D7 persistence scan: every persisted media src is an absolute
 * http(s)/plethora-asset URL; no <base> element survived. */
function countNonAbsoluteMediaSrc(html: string): { count: number; offenders: string[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const offenders: string[] = [];
  doc.querySelectorAll('img[src], source[src], video[src], audio[src]').forEach((el) => {
    const src = el.getAttribute('src') ?? '';
    if (!/^(https?:\/\/|plethora-asset:\/\/)/i.test(src)) {
      offenders.push(src);
    }
  });
  return { count: offenders.length, offenders };
}

beforeEach(() => {
  fetchMock.mockReset();
  setRenderedCaptureForTests({
    capture: vi.fn(async () => {
      throw new RenderedCaptureError('unavailable', 'static fixture must not need fallback');
    }),
  });
});

describe('arXiv import resource-resolution chain (end to end)', () => {
  it('resolves version-prefixed figures against the verbatim document URL and persists only absolute media', async () => {
    fetchMock.mockResolvedValue({
      html: ARXIV_PAGE,
      finalUrl: 'https://arxiv.org/html/2410.07524v1',
      status: 200,
      contentType: 'text/html',
      redirectHops: 0,
    });

    const outcome = await importArticle('https://arxiv.org/abs/2410.07524v1');

    // The abs→html adapter rewrote the fetch URL; the resource base is the
    // FINAL html URL verbatim — no trailing slash, no canonical /abs/ URL.
    expect(outcome.diagnostics.resourceBase).toEqual({
      base: 'https://arxiv.org/html/2410.07524v1',
      source: 'final',
    });
    expect(outcome.resolvedUrl).toBe('https://arxiv.org/html/2410.07524v1');
    expect(outcome.canonicalUrl).toBe('https://arxiv.org/abs/2410.07524v1');

    // Persisted src values: version-prefixed srcs absolutize against the
    // verbatim base (no doubled version directory), root-absolute chrome
    // lands on the origin, data: images are dropped by normalization.
    const doc = new DOMParser().parseFromString(outcome.article.contentHtml, 'text/html');
    const srcs = [...doc.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(srcs).toContain('https://arxiv.org/html/2410.07524v1/upcycle.png');
    expect(srcs).toContain('https://arxiv.org/html/2410.07524v1/moe-routing.svg');
    expect(srcs).toContain('https://arxiv.org/static/base/icons/arxiv-logo.png');
    expect(outcome.article.contentHtml).not.toContain('2410.07524v1/2410.07524v1');
    expect(outcome.article.contentHtml).not.toContain('data:text/html');

    // D7 scan: zero relative/scheme-relative media src, no <base>.
    const scan = countNonAbsoluteMediaSrc(outcome.article.contentHtml);
    expect(scan.offenders).toEqual([]);
    expect(doc.querySelector('base')).toBeNull();

    // D9: media outcome counts are recorded alongside the resource base.
    expect(outcome.diagnostics.media).toMatchObject({
      discovered: expect.any(Number),
      absolutized: expect.any(Number),
      dropped: expect.any(Number),
    });
    const media = outcome.diagnostics.media!;
    expect(media.absolutized).toBeGreaterThanOrEqual(3);
    expect(media.discovered).toBeGreaterThanOrEqual(media.absolutized);
  });

  it('re-anchors to the redirect-resolved final URL when the transport reports one', async () => {
    fetchMock.mockResolvedValue({
      html: ARXIV_PAGE,
      // Requested /html/2410.07524 (versionless) redirected to v2.
      finalUrl: 'https://arxiv.org/html/2410.07524v2',
      status: 200,
      contentType: 'text/html',
      redirectHops: 1,
    });

    const outcome = await importArticle('https://arxiv.org/html/2410.07524');
    expect(outcome.diagnostics.resourceBase).toEqual({
      base: 'https://arxiv.org/html/2410.07524v2',
      source: 'final',
    });
    // The page's v1-prefixed srcs explicitly name their own directory, so a
    // browser at the v2 URL computes the v1 asset URL — and so do we.
    expect(outcome.article.contentHtml).toContain('https://arxiv.org/html/2410.07524v1/upcycle.png');
    const scan = countNonAbsoluteMediaSrc(outcome.article.contentHtml);
    expect(scan.offenders).toEqual([]);
  });

  it('never uses the canonical URL as a resource base for generic sites', async () => {
    const page = `<!doctype html><html><head>
      <title>Generic Canonical Mismatch</title>
      <link rel="canonical" href="https://gen.example.com/canonical-slug">
      </head><body><article>
      <h1>Generic Canonical Mismatch</h1>
      ${'<p>Community organizers say the practical effects were visible within weeks, though the formal evaluation arrived much later, and the pattern they describe is consistent across every region examined by the reviewers this year.</p>'.repeat(12)}
      <figure><img src="figures/chart.png" alt="chart"><figcaption>Chart</figcaption></figure>
      </article></body></html>`;
    fetchMock.mockResolvedValue({
      html: page,
      finalUrl: 'https://gen.example.com/articles/2026/research/',
      status: 200,
      contentType: 'text/html',
      redirectHops: 0,
    });

    const outcome = await importArticle('https://gen.example.com/articles/2026/research/');
    expect(outcome.diagnostics.resourceBase).toEqual({
      base: 'https://gen.example.com/articles/2026/research/',
      source: 'final',
    });
    expect(outcome.canonicalUrl).toBe('https://gen.example.com/canonical-slug');
    expect(outcome.article.contentHtml).toContain(
      'https://gen.example.com/articles/2026/research/figures/chart.png'
    );
    expect(outcome.article.contentHtml).not.toContain('canonical-slug/figures');
    const scan = countNonAbsoluteMediaSrc(outcome.article.contentHtml);
    expect(scan.offenders).toEqual([]);
  });

  it('persists zero relative media src across every relative-URL shape (D7 scan)', async () => {
    const shapes = ['image.png', './image.png', '../image.png', 'images/image.png', '/root-image.png', '//cdn.example.org/image.png'];
    const page = `<!doctype html><html><head><title>All Shapes</title></head><body><article>
      <h1>All Shapes</h1>
      ${'<p>Analysts caution that a single quarter proves little, yet the trend has now persisted long enough to attract serious attention from every reviewer following the story this year and next.</p>'.repeat(12)}
      ${shapes.map((s, i) => `<figure><img src="${s}" alt="s${i}"><figcaption>F${i}</figcaption></figure>`).join('\n')}
      </article></body></html>`;
    fetchMock.mockResolvedValue({
      html: page,
      finalUrl: 'https://shapes.example.com/articles/2026/research/',
      status: 200,
      contentType: 'text/html',
      redirectHops: 0,
    });

    const outcome = await importArticle('https://shapes.example.com/articles/2026/research/');
    const scan = countNonAbsoluteMediaSrc(outcome.article.contentHtml);
    expect(scan.offenders).toEqual([]);
    // Protocol-relative normalized to https under the https document.
    expect(outcome.article.contentHtml).toContain('https://cdn.example.org/image.png');
    // And every surviving img is absolute http(s).
    const doc = new DOMParser().parseFromString(outcome.article.contentHtml, 'text/html');
    for (const img of doc.querySelectorAll('img')) {
      expect(img.getAttribute('src')).toMatch(/^https:\/\//);
    }
  });
});
