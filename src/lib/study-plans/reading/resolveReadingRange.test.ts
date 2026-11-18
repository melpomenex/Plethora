import { describe, expect, it } from 'vitest';
import {
  createReadingRangeResolver, normalizeReadingQuote, resolveDomPassage, uniqueQuote,
} from './resolveReadingRange';

function rootFor(html: string) {
  const root = document.createElement('article');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe('reading quote resolution', () => {
  it('maps passage boundaries across nested inline nodes and adjoining paragraphs', () => {
    const root = rootFor('<p>One <strong>sharp</strong> image.</p><p>Next <em>thought</em> and more.</p>');
    const match = resolveDomPassage(root, [{ quote: { exact: 'sharp image. Next thought' } }]);
    expect(match.status).toBe('exact');
    if (match.status !== 'exact') return;
    const [range] = match.ranges;
    expect(range.startContainer.textContent).toBe('sharp');
    expect(range.startOffset).toBe(0);
    expect(range.endContainer.textContent).toBe('thought');
    expect(range.endOffset).toBe(7);
  });

  it('rejects unresolved duplicates and accepts a unique surrounding context', () => {
    const root = rootFor('<p>Before: repeat me. Blue.</p><p>After: repeat me. Red.</p>');
    const resolve = createReadingRangeResolver(root);
    expect(resolve({ exact: 'repeat me.' }).status).toBe('ambiguous');
    const hit = resolve({ exact: 'repeat me.', prefix: 'After:', suffix: 'Red.' });
    expect(hit.status).toBe('exact');
    if (hit.status === 'exact') expect(hit.range.startContainer.parentElement).toBe(root.children[1]);
    expect(resolve({ exact: 'repeat me.', prefix: 'wrong' }).status).toBe('ambiguous');
  });

  it('normalizes typographic characters, composed accents, and whitespace with exact DOM offsets', () => {
    const root = rootFor('<p>Ignored <span hidden>match</span> “ﬁrst” — cafe\u0301.</p>');
    const output = createReadingRangeResolver(root)({ exact: '"first" - café.' });
    expect(output.status).toBe('exact');
    if (output.status === 'exact') expect(output.range.toString()).toBe('“ﬁrst” — cafe\u0301.');
    expect(normalizeReadingQuote('  Café\u00a0\t  ‘book’ ')).toBe("café 'book'");
    expect(uniqueQuote('testing', { exact: '' }).status).toBe('missing');
  });

  it('rejects reversed ranges and uses a unique structural selector', () => {
    const root = rootFor('<p id="one">Same text. First.</p><p id="two">Same text. Last.</p>');
    expect(resolveDomPassage(root, [
      { quote: { exact: 'Last.' } }, { quote: { exact: 'First.' } },
    ]).status).toBe('ambiguous');
    expect(resolveDomPassage(root, [
      { quote: { exact: 'Same text.' }, location: { kind: 'html', selector: '#two' } },
    ]).status).toBe('exact');
    expect(resolveDomPassage(root, [
      { quote: { exact: 'Same text.' }, location: { kind: 'html', selector: '[invalid' } },
    ]).status).toBe('ambiguous');
  });

  it('maps fragmented PDF text items with spaces and no inline wrapping', () => {
    const root = rootFor('<div class="textLayer"><span role="presentation">First line</span><br><span role="presentation">Second line</span></div>');
    const layer = root.firstElementChild!;
    const result = createReadingRangeResolver(layer, true)({ exact: 'line Second' });
    expect(result.status).toBe('exact');
    if (result.status === 'exact') {
      expect(result.range.startOffset).toBe(6);
      expect(result.range.endOffset).toBe(6);
    }
  });

  it('ignores head/title, decodes entities, and resolves word-aligned windows for clipped quotes', () => {
    const doc = document.implementation.createHTMLDocument('Test');
    doc.head.innerHTML = '<title>Book Title That Should Be Ignored</title>';
    doc.body.innerHTML = '<article><p><span class="stickup">A</span>t the risk of overdramatizing the human condition, Simon &amp; Schuster examines perception and illusion in everyday thought.</p></article>';
    const root = doc.body;
    const resolve = createReadingRangeResolver(root);

    // Book title in <head><title> must not leak into indexed text
    expect(resolve({ exact: 'Book Title That Should Be Ignored' }).status).toBe('missing');

    // Entity-encoded quote matches decoded DOM text and drop-cap span
    const entityMatch = resolve({ exact: 'At the risk of overdramatizing the human condition, Simon &amp; Schuster' });
    expect(entityMatch.status).toBe('exact');

    // Legacy mid-word clipped quote falls back cleanly via word-aligned anchor window
    const clippedMatch = resolve({
      exact: 'the risk of overdramatizing the human condition, Simon & Schuster examines percepti',
    });
    expect(clippedMatch.status).toBe('exact');
  });

  it('scopes PDF segments to #page-<pageNumber> when present in converted HTML', () => {
    const doc = document.implementation.createHTMLDocument('Converted PDF');
    doc.body.innerHTML = [
      '<div class="page" id="page-1"><p>Repeated passage across pages.</p></div>',
      '<div class="page" id="page-2"><p>Repeated passage across pages.</p></div>',
    ].join('');

    const result = resolveDomPassage(doc.body, [
      {
        quote: { exact: 'Repeated passage across pages.' },
        location: { kind: 'pdf', pageNumber: 2 },
      },
    ]);
    expect(result.status).toBe('exact');
    if (result.status === 'exact') {
      expect(result.ranges).toHaveLength(1);
      const container = result.ranges[0].startContainer.parentElement;
      expect(container?.closest('.page')?.id).toBe('page-2');
    }
  });
});
