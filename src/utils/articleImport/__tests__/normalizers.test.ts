import { describe, expect, it } from 'vitest';

import { normalizeArticle } from '../articleNormalizer';
import { bestSrcsetCandidate, normalizeImages, parseSrcset } from '../imageNormalizer';
import { sanitizeArticleHtml } from '../sanitizer';
import { parseFragment } from '../domUtils';

const PROSE = Array.from(
  { length: 10 },
  (_, i) => `<p>Paragraph ${i}: the researchers found that careful, repeated measurement of the samples produced consistent, publishable results across every trial they ran.</p>`
).join('\n');

const BASE_INPUT = {
  contentHtml: `<h1>Title Duplicate</h1>${PROSE}<p>Title Duplicate</p>`,
  title: 'Title Duplicate',
  authors: ['Sophie Hurwitz'],
  publishedTime: '2026-08-15T12:00:00Z',
  siteName: 'Mother Jones',
  baseUrl: 'https://www.motherjones.com/politics/2026/08/crypto-bank/',
};

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

describe('articleNormalizer shape', () => {
  const result = normalizeArticle(BASE_INPUT);

  it('produces the canonical article skeleton in order', () => {
    const doc = parse(result.article.contentHtml);
    const article = doc.querySelector('article.inc-article');
    expect(article).not.toBeNull();
    expect(article!.querySelector('header p.inc-publication')?.textContent).toBe('Mother Jones');
    expect(article!.querySelector('h1.inc-title')?.textContent).toBe('Title Duplicate');
    expect(article!.querySelector('p.inc-byline')?.textContent).toBe('Sophie Hurwitz · August 15, 2026');
    // Order: header, then inc-body.
    const order = Array.from(article!.children).map((el) =>
      el.classList.contains('inc-body') ? 'body' : el.tagName.toLowerCase()
    );
    expect(order).toEqual(['header', 'body']);
  });

  it('removes in-body title duplicates and enforces a single h1', () => {
    const doc = parse(result.article.contentHtml);
    expect(doc.querySelectorAll('h1').length).toBe(1);
    expect(doc.querySelector('.inc-body h1')).toBeNull();
    // The first paragraph (a duplicate of the title) is gone; prose remains.
    expect(doc.querySelectorAll('.inc-body p').length).toBe(10);
  });

  it('demotes body h1s to h2 (not deleted)', () => {
    const out = normalizeArticle({
      ...BASE_INPUT,
      contentHtml: `<h1>Title Duplicate</h1><h1>Some Section</h1>${PROSE}`,
    });
    const doc = parse(out.article.contentHtml);
    expect(doc.querySelectorAll('h1').length).toBe(1); // the header's
    expect(doc.querySelector('.inc-body h2')?.textContent).toBe('Some Section');
  });

  it('unwraps layout wrappers preserving reading order', () => {
    const out = normalizeArticle({
      ...BASE_INPUT,
      contentHtml: `<div><span><p>First paragraph with words.</p></span></div><div><font><p>Second paragraph here too.</p></font></div>`,
      title: 'Unwrapping',
    });
    const doc = parse(out.article.contentHtml);
    const body = doc.querySelector('.inc-body')!;
    expect(body.querySelector('div, span, font')).toBeNull();
    expect(Array.from(body.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'First paragraph with words.',
      'Second paragraph here too.',
    ]);
  });

  it('drops empty paragraphs and figure husks', () => {
    const out = normalizeArticle({
      ...BASE_INPUT,
      contentHtml: `${PROSE}<p>   </p><figure></figure><figure><img src="https://cdn.example.com/a.jpg" alt="kept"></figure>`,
    });
    const doc = parse(out.article.contentHtml);
    expect(doc.querySelectorAll('.inc-body figure').length).toBe(1);
    expect(doc.querySelectorAll('.inc-body p').length).toBe(10);
  });

  it('promotes the metadata hero image as inc-hero, deduped from the body', () => {
    const out = normalizeArticle({
      ...BASE_INPUT,
      heroImage: 'https://cdn.example.com/hero.jpg',
      contentHtml: `<figure><img src="https://cdn.example.com/hero.jpg" alt="Hero"><figcaption>The caption.</figcaption></figure>${PROSE}`,
    });
    const doc = parse(out.article.contentHtml);
    const hero = doc.querySelector('figure.inc-hero');
    expect(hero).not.toBeNull();
    expect(hero!.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/hero.jpg');
    expect(hero!.querySelector('figcaption')?.textContent).toBe('The caption.');
    // The body copy of the same figure is removed (dedupe).
    expect(doc.querySelectorAll('.inc-body img').length).toBe(0);
    expect(doc.querySelectorAll('img').length).toBe(1);
  });

  it('synthesizes a hero when the metadata image is not in the body', () => {
    const out = normalizeArticle({
      ...BASE_INPUT,
      heroImage: '/relative/hero.jpg', // relative og:image
    });
    const doc = parse(out.article.contentHtml);
    const hero = doc.querySelector('figure.inc-hero img');
    // Root-relative og:image resolves against the origin, per URL semantics.
    expect(hero?.getAttribute('src')).toBe('https://www.motherjones.com/relative/hero.jpg');
  });

  it('keeps reading order of mixed content stable', () => {
    const html = `
      <p>Alpha paragraph one.</p>
      <figure><img src="https://cdn.example.com/1.jpg" alt=""></figure>
      <p>Beta paragraph two.</p>
      <blockquote><p>Quoted material.</p></blockquote>
      <h2>A section</h2>
      <p>Gamma paragraph three.</p>
    `;
    const out = normalizeArticle({ ...BASE_INPUT, contentHtml: html, title: 'Order Test' });
    const doc = parse(out.article.contentHtml);
    const seq = Array.from(doc.querySelector('.inc-body')!.children).map((el) =>
      el.tagName.toLowerCase() === 'p' ? el.textContent!.slice(0, 4) : el.tagName.toLowerCase()
    );
    expect(seq).toEqual(['Alph', 'figure', 'Beta', 'blockquote', 'h2', 'Gamm']);
  });

  it('emits a plain-text derivative with word counts', () => {
    expect(result.article.textContent).toContain('Paragraph 0');
    expect(result.article.stats.words).toBeGreaterThan(50);
  });
});

describe('imageNormalizer', () => {
  it('parses srcset and picks the largest candidate ≤ cap', () => {
    const best = bestSrcsetCandidate(parseSrcset('a.jpg 800w, b.jpg 2400w, c.jpg 4000w'));
    expect(best?.url).toBe('b.jpg');
    // Nothing under the cap → largest overall.
    const onlyBig = bestSrcsetCandidate(parseSrcset('a.jpg 3000w, b.jpg 4000w'));
    expect(onlyBig?.url).toBe('b.jpg');
    // DPR descriptors derive nominal widths; 3x (=3000px) exceeds the
    // 2400 cap, so the 1x candidate wins.
    const dpr = bestSrcsetCandidate(parseSrcset('a.jpg 1x, b.jpg 3x'));
    expect(dpr?.url).toBe('a.jpg');
  });

  it('resolves data-src lazy attributes over placeholder srcs', () => {
    const container = parseFragment(
      `<img src="data:image/gif;base64,AAAA" data-src="/img/real.jpg" alt="Lazy">`
    );
    normalizeImages(container, 'https://example.com/story/');
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://example.com/img/real.jpg');
    expect(img.getAttribute('data-src')).toBeNull();
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('resolves relative srcset URLs absolutely', () => {
    const container = parseFragment(
      `<img src="/placeholder.gif" srcset="/img/800.jpg 800w, /img/1600.jpg 1600w" alt="">`
    );
    normalizeImages(container, 'https://cdn.example.com/articles/1/');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/img/1600.jpg'
    );
    expect(container.querySelector('img')?.getAttribute('srcset')).toBeNull();
  });

  it('rejects 1×1 tracking pixels by attribute', () => {
    const container = parseFragment(
      `<img src="https://tracker.example.com/pixel.gif" width="1" height="1" alt=""><img src="https://example.com/fine.jpg" width="640" alt="">`
    );
    const report = normalizeImages(container, 'https://example.com/');
    expect(container.querySelectorAll('img').length).toBe(1);
    expect(report.droppedImages).toBe(1);
  });

  it('rejects images whose source repeats ≥ 3 times (logos)', () => {
    const container = parseFragment(
      `<img src="https://example.com/logo.png" alt="l1"><img src="https://example.com/logo.png" alt="l2"><img src="https://example.com/logo.png" alt="l3"><img src="https://example.com/unique.jpg" alt="">`
    );
    normalizeImages(container, 'https://example.com/');
    expect(container.querySelectorAll('img').length).toBe(1);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/unique.jpg');
  });

  it('collapses <picture> to its best source on the img', () => {
    const container = parseFragment(
      `<picture><source srcset="https://cdn.example.com/small.jpg 600w, https://cdn.example.com/big.jpg 1800w"><img src="https://cdn.example.com/fallback.jpg" alt="P"></picture>`
    );
    normalizeImages(container, 'https://example.com/');
    expect(container.querySelector('picture')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/big.jpg');
  });

  it('drops images with only data: URLs', () => {
    const container = parseFragment(
      `<img src="data:image/png;base64,AAAA" alt="inline">`
    );
    const report = normalizeImages(container, 'https://example.com/');
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(report.droppedImages).toBe(1);
  });
});

describe('sanitizer', () => {
  it('survives semantic content and strips non-semantic wrappers/attrs', async () => {
    const html = `<article class="inc-article" data-x="1"><header><h1 class="inc-title" style="color:red">T</h1></header><div class="inc-body"><p style="margin:0" class="x">Text <b>bold</b> <a href="https://e.com/" onclick="steal()" class="btn">link</a>.</p><ul><li>one</li></ul><table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><pre><code>x=1</code></pre><math><mrow><mi>a</mi><mo>+</mo><msup><mi>b</mi><mn>2</mn></msup></mrow></math><figure><img src="https://cdn.example.com/i.jpg" alt="i" loading="eager"><figcaption>cap</figcaption></figure></div></article>`;
    const { html: out } = await sanitizeArticleHtml(html);
    const doc = parse(out);
    expect(doc.querySelector('article')).not.toBeNull();
    expect(doc.querySelector('h1')?.textContent).toBe('T');
    expect(doc.querySelector('b')).not.toBeNull();
    expect(doc.querySelector('ul li')?.textContent).toBe('one');
    expect(doc.querySelector('th')?.getAttribute('colspan')).toBe('2');
    expect(doc.querySelector('pre code')).not.toBeNull();
    expect(doc.querySelector('math')).not.toBeNull();
    expect(doc.querySelector('math msup')).not.toBeNull();
    expect(doc.querySelector('figure figcaption')?.textContent).toBe('cap');
    // No publisher class/style/data-* survives; only inc-* structural hooks.
    expect(out).not.toMatch(/class="x/);
    expect(out).not.toMatch(/class="btn/);
    expect(doc.querySelector('article')?.getAttribute('class')).toBe('inc-article');
    expect(doc.querySelector('h1')?.getAttribute('class')).toBe('inc-title');
    expect(out).not.toMatch(/style=/);
    expect(out).not.toMatch(/data-/);
    // Semantic content kept in order.
    const a = doc.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://e.com/');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('XSS battery: script, img onerror, javascript:, data:, svg, form, iframe, noscript', async () => {
    const payload = [
      '<script>alert(1)</script>',
      '<img src="https://ok.example.com/x.jpg" onerror="alert(2)" alt="">',
      '<a href="javascript:alert(3)">click</a>',
      '<a href="JAVASCRIPT:x">upper</a>',
      '<a href="data:text/html,<script>alert(4)</script>">data link</a>',
      '<img src="data:image/svg+xml;base64,AAAA" alt="data img">',
      '<svg><script>alert(5)</script></svg>',
      '<svg onload="alert(6)"></svg>',
      '<form action="https://evil.example.com"><input type="text" name="x"><button>go</button></form>',
      '<iframe src="https://evil.example.com"></iframe>',
      '<object data="https://evil.example.com/x.swf"></object>',
      '<embed src="https://evil.example.com/x.svg">',
      '<style>body{background:url(javascript:alert(7))}</style>',
      '<template><img src=x onerror=alert(8)></template>',
      '<noscript><p title="</noscript><img src=x onerror=alert(9)>">noscript trick</noscript>',
      '<math><maction actiontype="statusline#http://evil.example.com" xlink:href="javascript:alert(10)">click</maction></math>',
      '<a href="vbscript:msgbox(11)">vbs</a>',
      '<a href="unknown-scheme:whatever">unknown</a>',
    ].join('\n');
    const { html: out } = await sanitizeArticleHtml(`<div><p>safe text</p>${payload}</div>`);
    const doc = parse(out);

    // Re-parse inertness: no scripts, no handlers, no dangerous URLs.
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out.toLowerCase()).not.toContain('vbscript:');
    expect(doc.querySelector('script, iframe, object, embed, form, input, button, svg, template, noscript, style')).toBeNull();
    // Anchor text preserved where DOMPurify keeps the element; any surviving
    // href is scheme-safe.
    const anchors = Array.from(doc.querySelectorAll('a'));
    expect(anchors.some((a) => a.textContent === 'click')).toBe(true);
    anchors.forEach((a) => {
      const href = a.getAttribute('href');
      if (href) expect(href).toMatch(/^(https?:|mailto:|#)/i);
    });
    expect(doc.querySelector('a[href^="javascript" i], a[href^="vbscript" i], a[href^="data:" i]')).toBeNull();
    // The clean image survived without handlers.
    const img = doc.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://ok.example.com/x.jpg');
    // data: image was dropped entirely.
    expect(Array.from(doc.querySelectorAll('img')).map((i) => i.getAttribute('src'))).not.toContain(
      expect.stringContaining('data:')
    );
    // MathML carrying an xlink:href attack is dropped wholesale by
    // DOMPurify's XML-safety pass — nothing scheme-hostile survives.
    expect(out.toLowerCase()).not.toContain('xlink:href');
    expect(out.toLowerCase()).not.toContain('evil.example.com');
  });

  it('only paired generated fragments are allowed; mailto is allowed', async () => {
    const { html: out, warnings } = await sanitizeArticleHtml(
      `<p><a href="#inc-ref-1">jump</a> <a href="#section">unsafe jump</a> <a href="#inc-ref-2">missing</a> <a href="mailto:x@example.com">mail</a></p><section id="inc-ref-1">Target</section>`
    );
    const doc = parse(out);
    expect(doc.querySelector('a[href="#inc-ref-1"]')).not.toBeNull();
    expect(doc.querySelector('a[href="#section"]')).toBeNull();
    expect(doc.querySelector('a[href="#inc-ref-2"]')).toBeNull();
    expect(doc.querySelector('#inc-ref-1')).not.toBeNull();
    expect(doc.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(warnings.some((warning) => warning.includes('inc-ref-2'))).toBe(true);
  });

  it('counts dropped items for diagnostics', async () => {
    // ftp passes DOMPurify's default URI regexp but not our link policy, so
    // the drop is attributable to OUR hook (deterministic count).
    const { report } = await sanitizeArticleHtml(
      `<div><p>keep</p><script>x</script><span style="a:1">styled</span><a href="ftp://files.example.com/x">f</a></div>`
    );
    expect(report.droppedTags).toBeGreaterThan(0);
    expect(report.droppedAttributes).toBeGreaterThan(0);
    expect(report.droppedUrls).toBe(1);
  });
});
