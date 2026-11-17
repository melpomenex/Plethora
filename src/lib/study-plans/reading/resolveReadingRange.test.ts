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
});
