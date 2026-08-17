/**
 * Pipeline-level rendered-fallback tests using an injected fake capture
 * client (the real platform clients are validated by the manual matrix).
 * Fetch is mocked with fixture HTML — the suite is offline-hermetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, tauriState } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  tauriState: { isTauri: false, platform: null as string | null },
}));

vi.mock('../../../lib/tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/tauri')>();
  return {
    ...actual,
    isTauri: () => tauriState.isTauri,
    nativePlatform: () => tauriState.platform,
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
import type { RenderedCaptureResult } from '../types';

/** A JS-rendered app shell: no article content in the static HTML. */
const JS_SHELL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Newsy | App</title>
<script src="/app.js" defer></script></head>
<body><div id="root"><div class="loading">Loading…</div></div></body></html>`;

/** The DOM the fake renderer "produced" after hydration: a real article. */
const RENDERED_ARTICLE_HTML = `<!doctype html>
<html lang="en"><head>
<title>A Rendered Investigation | Newsy</title>
<meta property="og:title" content="A Rendered Investigation">
<meta property="og:site_name" content="Newsy">
<meta property="article:published_time" content="2026-08-15T09:00:00Z">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"A Rendered Investigation","author":[{"name":"Rene Rendered"}],"datePublished":"2026-08-15T09:00:00Z","publisher":{"name":"Newsy"}}</script>
</head><body>
<nav><a href="/">Home</a><a href="/x">Topics</a></nav>
<main><article>
<h1>A Rendered Investigation</h1>
<p>By Rene Rendered</p>
${Array.from({ length: 24 }, (_, i) => `<p>This rendered paragraph ${i} contains the kind of careful, measured prose that readers expect from a fully hydrated client application, with details that only exist after scripts have run.</p>`).join('\n')}
<figure><img src="https://cdn.newsy.example.com/hero.jpg" alt="Hero"><figcaption>The story in one image.</figcaption></figure>
<h2>What comes next</h2>
${Array.from({ length: 8 }, (_, i) => `<p>Section paragraph ${i} continues the narrative with additional reporting, context from officials, and numbers that parse identically every single run of this suite.</p>`).join('\n')}
</article></main>
</body></html>`;

function shellFetch(): void {
  fetchMock.mockResolvedValue({
    html: JS_SHELL_HTML,
    finalUrl: 'https://newsy.example.com/story/1',
    status: 200,
    contentType: 'text/html',
    redirectHops: 0,
  });
}

function fakeCapture(result: () => Promise<RenderedCaptureResult>): RenderedDomCapture {
  return { capture: vi.fn(result) };
}

beforeEach(() => {
  fetchMock.mockReset();
  setRenderedCaptureForTests(null);
});

describe('rendered-page fallback integration', () => {
  it('JS-shell static page triggers fallback; hydrated DOM wins with a rendered- extractor', async () => {
    shellFetch();
    const capture = fakeCapture(async () => ({
      html: RENDERED_ARTICLE_HTML,
      finalUrl: 'https://newsy.example.com/story/1',
      durationMs: 1234,
    }));
    setRenderedCaptureForTests(capture);

    const outcome = await importArticle('https://newsy.example.com/story/1');
    expect(capture.capture).toHaveBeenCalledTimes(1);
    expect(outcome.diagnostics.renderedFallbackUsed).toBe(true);
    expect(outcome.diagnostics.selected?.engine).toMatch(/^rendered-/);
    expect(['medium', 'high']).toContain(outcome.diagnostics.selected?.confidence);
    expect(outcome.article.title).toBe('A Rendered Investigation');
    expect(outcome.article.byline).toContain('Rene Rendered');
    expect(outcome.article.textContent).not.toContain('Loading');
    expect(outcome.article.contentHtml).toContain('inc-article');
  });

  it('fallback is not the default: a medium+ static page never renders', async () => {
    fetchMock.mockResolvedValue({
      html: RENDERED_ARTICLE_HTML.replace(
        '<title>A Rendered Investigation | Newsy</title>',
        '<title>A Static Story | Newsy</title>'
      ).replaceAll('A Rendered Investigation', 'A Static Story'),
      finalUrl: 'https://newsy.example.com/story/2',
      status: 200,
      contentType: 'text/html',
      redirectHops: 0,
    });
    const capture = fakeCapture(async () => {
      throw new Error('must not be called');
    });
    setRenderedCaptureForTests(capture);

    const outcome = await importArticle('https://newsy.example.com/story/2');
    expect(capture.capture).not.toHaveBeenCalled();
    expect(outcome.diagnostics.renderedFallbackUsed).toBeFalsy();
    expect(outcome.diagnostics.selected?.engine).toMatch(/^(defuddle|readability)$/);
  });

  it('rendered candidate must still earn selection — another empty shell fails typed', async () => {
    shellFetch();
    // The rendered DOM is ALSO an empty shell (hydration failed): rendering
    // must not count as an automatic win.
    setRenderedCaptureForTests(
      fakeCapture(async () => ({
        html: JS_SHELL_HTML,
        finalUrl: 'https://newsy.example.com/story/1',
        durationMs: 500,
      }))
    );

    await expect(importArticle('https://newsy.example.com/story/1')).rejects.toMatchObject({
      code: 'low_confidence',
    });
  });

  it('capture timeout → rendered_failed, no document produced', async () => {
    shellFetch();
    setRenderedCaptureForTests(
      fakeCapture(async () => {
        throw new RenderedCaptureError('timeout', 'budget exceeded');
      })
    );

    const err = await importArticle('https://newsy.example.com/story/1').catch((e) => e);
    expect(err).toBeInstanceOf(ArticleImportError);
    expect((err as ArticleImportError).code).toBe('rendered_failed');
  });

  it('platform without capture capability → rendered_unavailable', async () => {
    shellFetch();
    setRenderedCaptureForTests(null); // no fake: the registry picks by platform
    tauriState.isTauri = true;
    tauriState.platform = 'ios'; // iOS: no capture client exists yet
    try {
      const err = await importArticle('https://newsy.example.com/story/1').catch((e) => e);
      expect((err as ArticleImportError).code).toBe('rendered_unavailable');
    } finally {
      tauriState.isTauri = false;
      tauriState.platform = null;
    }
  });

  it('cancellation aborts with the typed canceled code', async () => {
    shellFetch();
    const controller = new AbortController();
    setRenderedCaptureForTests(
      fakeCapture(async () => {
        controller.abort();
        throw new RenderedCaptureError('canceled');
      })
    );

    const err = await importArticle('https://newsy.example.com/story/1', {
      signal: controller.signal,
    }).catch((e) => e);
    expect((err as ArticleImportError).code).toBe('canceled');
  });
});
