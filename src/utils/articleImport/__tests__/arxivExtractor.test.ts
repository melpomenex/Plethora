import { describe, expect, it } from 'vitest';
import {
  ARXIV_FIXTURE_URL,
  headingSequence,
  readArticleFixture,
  runArxivFixtureToFinalDom,
  textOrder,
} from './articleTestHelpers';
import { parseHtml } from '../domUtils';
import { extractArxivHtml } from '../engines/site-specific/arxiv';

const html = readArticleFixture('arxiv-html-regression');

describe('extractArxivHtml', () => {
  it('extracts structured paper content from LaTeXML HTML', () => {
    const doc = parseHtml(html);
    const candidate = extractArxivHtml(doc, ARXIV_FIXTURE_URL);
    expect(candidate).not.toBeNull();
    expect(candidate!.engine).toBe('site:arxiv.org');
    expect(candidate!.title).toContain('Upcycling');
    expect(candidate!.stats.words).toBeGreaterThan(400);
    expect(candidate!.textContent).toContain('MMLU');
    expect(candidate!.textContent).not.toContain('Learn more');
    // Version-prefixed src survives extraction verbatim (absolutization is
    // the pipeline's job, against the verbatim document URL).
    expect(candidate!.contentHtml).toContain('2410.07524v1/moe-routing.svg');
    expect(candidate!.contentHtml).not.toMatch(/\bltx_|publisher-/);
  });

  it('preserves scholarly semantics through the final sanitizer boundary', async () => {
    const { finalDocument, sanitized } = await runArxivFixtureToFinalDom();
    const article = finalDocument.querySelector('.inc-article');
    const body = article?.querySelector(':scope > .inc-body');

    expect(article).not.toBeNull();
    expect(body).not.toBeNull();
    expect(article!.querySelectorAll(':scope > header .inc-title')).toHaveLength(1);
    expect(article!.querySelectorAll(':scope > header .inc-byline')).toHaveLength(1);
    expect(article!.querySelectorAll('h1')).toHaveLength(1);
    expect(headingSequence(article!)).toEqual(expect.arrayContaining([
      'h1:Upcycling Large Language Models into Mixture of Experts',
      'h2:Abstract',
      'h2:1 Introduction',
      'h3:1.1 Contributions',
      'h4:1.1.1 Notation',
    ]));
    expect(article!.querySelectorAll('.inc-abstract')).toHaveLength(1);
    expect(article!.querySelectorAll('.inc-abstract h2')).toHaveLength(1);

    expect(article!.querySelector('.inc-theorem')).not.toBeNull();
    expect(article!.querySelector('.inc-proof')).not.toBeNull();
    expect(article!.querySelector('ul ul')).not.toBeNull();
    expect(article!.querySelector('dl > dt')).not.toBeNull();
    expect(article!.querySelector('strong')?.textContent).toContain('better accuracy');
    expect(article!.querySelector('em')?.textContent).toContain('extensive study');
    expect(article!.querySelector('small')).not.toBeNull();
    expect(article!.querySelector('sup')).not.toBeNull();
    expect(article!.querySelector('sub')).not.toBeNull();

    expect(article!.querySelectorAll('math')).toHaveLength(2);
    expect(article!.querySelector('p > math:not([display="block"])')).not.toBeNull();
    expect(article!.querySelector('.inc-equation.inc-wide math[display="block"]')).not.toBeNull();
    expect(article!.querySelector('math[aria-label="a plus b squared"]')).not.toBeNull();
    expect(article!.querySelector('.inc-equation-number')?.textContent).toBe('(1)');

    const figureSrcs = Array.from(article!.querySelectorAll('figure img')).map(
      (img) => img.getAttribute('src')
    );
    expect(figureSrcs).toEqual([
      'https://arxiv.org/html/2410.07524v1/upcycle.png',
      'https://arxiv.org/html/2410.07524v1/moe-routing.svg',
    ]);
    expect(article!.querySelector('figure figcaption')).not.toBeNull();
    expect(article!.querySelector('.inc-table-wrap > table')).not.toBeNull();
    expect(article!.querySelector('table th[scope="col"]')).not.toBeNull();

    expect(article!.querySelector('.inc-bibliography .inc-reference')).not.toBeNull();
    expect(article!.querySelector('.inc-footnotes .inc-footnote')).not.toBeNull();
    const fragmentLinks = Array.from(article!.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    expect(fragmentLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of fragmentLinks) {
      const id = link.getAttribute('href')!.slice(1);
      expect(id).toMatch(/^inc-ref-[1-9]\d*$/);
      expect(article!.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }

    const order = textOrder(article!, [
      'Abstract',
      '1 Introduction',
      '1.1 Contributions',
      '1.1.1 Notation',
      '2 Methodology',
      'Theorem 1',
      'Proof.',
      'Notes',
      'References',
    ]);
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    expect(sanitized.html).toContain('Visible unsafe link text');
    const unsafeVisibleLink = Array.from(article!.querySelectorAll('a')).find(
      (link) => link.textContent === 'Visible unsafe link text'
    );
    expect(unsafeVisibleLink).toBeDefined();
    expect(unsafeVisibleLink?.hasAttribute('class')).toBe(false);
    expect(unsafeVisibleLink?.hasAttribute('href')).toBe(false);
    expect(unsafeVisibleLink?.hasAttribute('aria-labelledby')).toBe(false);
    expect(sanitized.html).not.toMatch(/\bltx_|publisher-|arbitrary-id|attacker-label/);
    expect(sanitized.html).not.toMatch(/<script|<style|<iframe|<object|<embed|<form|<svg/i);
    expect(sanitized.html).not.toMatch(/\son[a-z]+=|\sstyle=|javascript:|data:text\/html/i);
  });
});
