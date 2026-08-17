import { describe, expect, it } from 'vitest';

import { computeStats, deepCloneDocument, parseFragment, parseHtml } from '../domUtils';
import { confidenceFor, scoreCandidate, selectBestCandidate } from '../scorer';
import { extractPageMetadata } from '../metadataExtractor';
import type { ExtractionCandidate, ScoredCandidate } from '../types';

/** Deterministic prose generator — same seed phrase, same words, forever. */
function prose(paragraphs: number, sentence = 'The committee reviewed the proposal carefully, and its members agreed that further study, funded properly, would clarify the remaining questions.'): string {
  return Array.from({ length: paragraphs }, () => `<p>${sentence}</p>`).join('');
}

function makeCandidate(html: string, overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  const container = parseFragment(html);
  return {
    engine: 'defuddle',
    contentHtml: html,
    textContent: (container.textContent ?? '').replace(/\s+/g, ' ').trim(),
    stats: computeStats(container),
    ...overrides,
  };
}

function emptyMeta() {
  return extractPageMetadata(parseHtml('<html><body><p>x</p></body></html>'));
}

function ctx(overrides: Partial<Parameters<typeof scoreCandidate>[1]> = {}) {
  return { meta: emptyMeta(), sourceWords: 500, ...overrides };
}

describe('scoreCandidate determinism', () => {
  it('produces identical scores for identical inputs', () => {
    const candidate = makeCandidate(`<h2>Section</h2>${prose(20)}<figure><img src="https://x/i.jpg" alt=""><figcaption>A caption.</figcaption></figure>`);
    const a = scoreCandidate(candidate, ctx());
    const b = scoreCandidate(candidate, ctx());
    expect(a.score).toBe(b.score);
    expect(a.confidence).toBe(b.confidence);
    expect(a.reasons).toEqual(b.reasons);
  });

  it('does not depend on object identity or key order', () => {
    const html = prose(15);
    const a = scoreCandidate(makeCandidate(html), ctx());
    const b = scoreCandidate(makeCandidate(html, { engine: 'readability' }), ctx());
    expect(a.score).toBe(b.score);
  });
});

describe('chrome-heavy candidate loses to prose candidate', () => {
  it('nav/subscribe/related soup scores far below coherent prose', () => {
    const chromeHtml = `
      <nav><a href="/a">Home</a> <a href="/b">Topics</a> <a href="/c">About</a> <a href="/d">Contact</a></nav>
      <p>Subscribe to our newsletter. Sign up now. Donate to support our journalism.</p>
      <ul>
        <li><a href="/r1">Related: Something</a></li>
        <li><a href="/r2">Related: Something</a></li>
        <li><a href="/r3">Related: Something</a></li>
        <li><a href="/r4">Related: Something</a></li>
        <li><a href="/r5">Recommended: Else</a></li>
        <li><a href="/r6">Recommended: Else</a></li>
      </ul>
      <div><a href="/f1">Privacy</a> <a href="/f2">Terms</a> <a href="/f3">Share</a> <a href="/f4">Comments</a> <a href="/f5">Log in</a> <a href="/f6">Register</a> <a href="/f7">Latest</a></div>
      <p>We see you're using an ad blocker. One quick request...</p>
    `;
    // Realistic prose candidate: the engine extracted a title/byline that
    // agrees with the page metadata (as it does on real articles).
    const meta = extractPageMetadata(parseHtml(`
      <html><head>
        <meta property="og:title" content="A Coherent Analysis of Committee Work">
        <meta property="og:site_name" content="Serious Paper">
        <meta property="article:published_time" content="2026-08-15T00:00:00Z">
      </head><body><p>x</p></body></html>`));
    const proseCandidate = makeCandidate(prose(30), {
      title: 'A Coherent Analysis of Committee Work',
      byline: 'Staff Writer',
      publishedTime: '2026-08-15T00:00:00Z',
    });
    const chromeCandidate = makeCandidate(chromeHtml);

    const proseScored = scoreCandidate(proseCandidate, ctx({ meta, sourceWords: proseCandidate.stats.words }));
    const chromeScored = scoreCandidate(chromeCandidate, ctx({ meta }));

    expect(proseScored.score).toBeGreaterThan(chromeScored.score + 25);
    expect(chromeScored.reasons).toEqual(
      expect.arrayContaining(['chrome_lexicon', 'chrome_link_fragments', 'chrome_repeated_blocks', 'chrome_footer_cluster'])
    );
    expect(proseScored.confidence).not.toBe('low');
    expect(chromeScored.confidence).toBe('low');
  });
});

describe('completeness penalty', () => {
  it('a tiny extraction of a large source is penalized; same words from a small source is not', () => {
    const small = makeCandidate(prose(7)); // ~133 words
    const words = small.stats.words;
    expect(words).toBeGreaterThanOrEqual(120);

    const fromSmallSource = scoreCandidate(small, ctx({ sourceWords: words }));
    const fromLargeSource = scoreCandidate(small, ctx({ sourceWords: words * 8 }));

    expect(fromLargeSource.reasons).toContain('incomplete_extraction');
    expect(fromLargeSource.score).toBeLessThan(fromSmallSource.score);
  });

  it('JSON-LD articleBody length feeds completeness', () => {
    const candidate = makeCandidate(prose(7));
    const short = scoreCandidate(candidate, ctx({ jsonLdArticleBodyChars: 500 }));
    const long = scoreCandidate(candidate, ctx({ jsonLdArticleBodyChars: 20000 }));
    expect(long.reasons).toContain('incomplete_extraction');
    expect(long.score).toBeLessThan(short.score);
  });
});

describe('confidence buckets', () => {
  it('maps boundary scores exactly', () => {
    expect(confidenceFor(100)).toBe('high');
    expect(confidenceFor(70)).toBe('high');
    expect(confidenceFor(69.9)).toBe('medium');
    expect(confidenceFor(40)).toBe('medium');
    expect(confidenceFor(39.9)).toBe('low');
    expect(confidenceFor(0)).toBe('low');
  });

  it('healthy prose with structure and metadata reaches medium+ confidence', () => {
    const html = `
      <figure><img src="https://cdn.example.com/hero.jpg" alt="Hero"><figcaption>Hero image caption.</figcaption></figure>
      <h2>Background</h2>${prose(25)}
      <h2>Analysis</h2>${prose(25)}
      <blockquote><p>This is a quoted statement from an official.</p></blockquote>
      ${prose(10)}
    `;
    const meta = extractPageMetadata(parseHtml(`
      <html><head>
        <meta property="og:title" content="A Serious News Story About Policy">
        <meta property="og:site_name" content="Serious News">
        <meta property="article:published_time" content="2026-08-15T00:00:00Z">
      </head><body><p>x</p></body></html>`));
    const candidate = makeCandidate(html, { title: 'A Serious News Story About Policy', byline: 'Reporter Name', publishedTime: '2026-08-15T00:00:00Z' });
    const scored = scoreCandidate(candidate, ctx({ meta, sourceWords: candidate.stats.words + 40 }));
    expect(scored.score).toBeGreaterThanOrEqual(45);
    expect(['medium', 'high']).toContain(scored.confidence);
    expect(scored.reasons).toEqual(expect.arrayContaining(['prose_volume', 'contiguous_prose', 'metadata_agreement']));
  });
});

describe('selectBestCandidate tie-breaks', () => {
  const scored = (engine: string, score: number): ScoredCandidate => ({
    candidate: makeCandidate(prose(3), { engine }),
    score,
    confidence: confidenceFor(score),
    reasons: [],
  });
  // Keep the stats.words used for tie-break consistent with the fixture.
  function withWords(s: ScoredCandidate, words: number): ScoredCandidate {
    s.candidate.stats.words = words;
    return s;
  }

  it('highest score wins outright', () => {
    const best = selectBestCandidate([scored('defuddle', 60), scored('readability', 70)]);
    expect(best?.candidate.engine).toBe('readability');
  });

  it('score tie: defuddle beats readability', () => {
    const best = selectBestCandidate([withWords(scored('readability', 60), 400), withWords(scored('defuddle', 60), 300)]);
    expect(best?.candidate.engine).toBe('defuddle');
  });

  it('score tie: site-specific beats generic engines', () => {
    const best = selectBestCandidate([
      withWords(scored('defuddle', 60), 400),
      withWords(scored('readability', 60), 500),
      withWords(scored('site:wikipedia.org', 60), 300),
    ]);
    expect(best?.candidate.engine).toBe('site:wikipedia.org');
  });

  it('score + engine tie: more words win', () => {
    const best = selectBestCandidate([
      withWords(scored('defuddle', 60), 300),
      withWords(scored('defuddle', 60), 500),
    ]);
    expect(best?.candidate.stats.words).toBe(500);
  });

  it('empty input yields null', () => {
    expect(selectBestCandidate([])).toBeNull();
  });
});

describe('engine clone isolation (domUtils)', () => {
  it('deepCloneDocument yields fully independent copies', () => {
    const original = parseHtml(`<html><body><div id="a"><p>One</p><p>Two</p></div></body></html>`);
    const cloneA = deepCloneDocument(original);
    const cloneB = deepCloneDocument(original);
    cloneA.body.querySelector('p')?.remove();
    cloneB.body.querySelector('div')?.setAttribute('data-x', '1');
    expect(original.querySelectorAll('p').length).toBe(2);
    expect(cloneA.querySelectorAll('p').length).toBe(1);
    expect(cloneB.querySelectorAll('p').length).toBe(2);
    expect(cloneB.querySelector('div')?.getAttribute('data-x')).toBe('1');
    expect(cloneA.querySelector('div')?.getAttribute('data-x')).toBeNull();
  });
});

describe('real engines against clones', () => {
  it('defuddle mutating its clone leaves readability\'s clone untouched', async () => {
    const { runDefuddle } = await import('../engines/defuddleExtractor');
    const { runReadability } = await import('../engines/readabilityExtractor');
    const html = `<!doctype html><html><head><title>Real Story | News Site</title></head><body>
      <nav><a href="/">Home</a><a href="/x">Menu</a></nav>
      <article>
        <h1>Real Story Headline Here</h1>
        <p>Byline Staff</p>
        ${prose(40)}
      </article>
      <footer><a href="/p">Privacy</a><a href="/t">Terms</a></footer>
    </body></html>`;
    const original = parseHtml(html);
    const forDefuddle = deepCloneDocument(original);
    const forReadability = deepCloneDocument(original);

    const defuddleResult = await runDefuddle(forDefuddle, 'https://news.example.com/story');
    const readabilityResult = await runReadability(forReadability);

    // Readability must still see the article regardless of what defuddle
    // did to its own copy, and the original stays pristine.
    expect(readabilityResult).not.toBeNull();
    expect(readabilityResult!.stats.words).toBeGreaterThan(200);
    expect(original.querySelectorAll('article p').length).toBe(41); // 40 prose + byline

    // Both engines produced candidates from the same source.
    expect(defuddleResult).not.toBeNull();
  });

  it('engine failures degrade to null-or-candidate results, never throws', async () => {
    const { runDefuddle } = await import('../engines/defuddleExtractor');
    const { runReadability } = await import('../engines/readabilityExtractor');
    const empty = parseHtml('<html><body></body></html>');
    const d = await runDefuddle(deepCloneDocument(empty), 'https://example.com/empty');
    const r = await runReadability(deepCloneDocument(empty));
    expect(d === null || typeof d.contentHtml === 'string').toBe(true);
    expect(r === null || typeof r.contentHtml === 'string').toBe(true);
  });
});
