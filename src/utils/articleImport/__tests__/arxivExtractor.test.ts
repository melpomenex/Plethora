import { describe, expect, it } from 'vitest';
import { parseHtml } from '../domUtils';
import { extractArxivHtml } from '../engines/site-specific/arxiv';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(
  join(here, 'fixtures/arxiv-html-regression/page.html'),
  'utf-8'
);

describe('extractArxivHtml', () => {
  it('extracts structured paper content from LaTeXML HTML', () => {
    const doc = parseHtml(html);
    const candidate = extractArxivHtml(doc, 'https://arxiv.org/html/2410.07524v1/');
    expect(candidate).not.toBeNull();
    expect(candidate!.engine).toBe('site:arxiv.org');
    expect(candidate!.title).toContain('Upcycling');
    expect(candidate!.stats.words).toBeGreaterThan(400);
    expect(candidate!.textContent).toContain('MMLU');
    expect(candidate!.textContent).not.toContain('Learn more');
    expect(candidate!.contentHtml).toContain('x1.png');
  });
});
