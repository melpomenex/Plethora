import { describe, expect, it } from 'vitest';
import { prepareHtmlDocument } from '../prepareHtmlDocument';

describe('prepareHtmlDocument', () => {
  it('wraps canonical fragments without changing semantic text order', () => {
    const source =
      '<article class="inc-article"><div class="inc-body"><h2>First</h2><p>Alpha <strong>bold</strong></p><img src="figures/a.png" alt="A"><h3>Second</h3><p>Omega</p></div></article>';
    const prepared = prepareHtmlDocument({
      html: source,
      kind: 'canonical-article',
      title: 'Paper',
      baseUrl: 'https://arxiv.org/html/2410.1/',
      preserveImages: true,
    });
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    const sourceDoc = new DOMParser().parseFromString(source, 'text/html');

    expect(doc.querySelector('base')?.href).toBe('https://arxiv.org/html/2410.1/');
    expect(doc.querySelector('img')?.src).toBe('https://arxiv.org/html/2410.1/figures/a.png');
    expect(doc.body.textContent).toBe(sourceDoc.body.textContent);
    expect(doc.querySelector('strong')).not.toBeNull();
  });

  it('defensively removes active/presentation content and obeys image policy', () => {
    const prepared = prepareHtmlDocument({
      html: '<article class="inc-article"><div class="inc-body"><style>p{}</style><script>x</script><p style="color:red" onclick="x()">Safe</p><img src="https://e.test/x.png"></div></article>',
      kind: 'canonical-article',
      title: 'Paper',
      baseUrl: 'https://example.com/',
      preserveImages: false,
    });
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    expect(doc.body.textContent).toContain('Safe');
    expect(doc.querySelector('script, style, img')).toBeNull();
    expect(doc.querySelector('p')?.hasAttribute('style')).toBe(false);
    expect(doc.querySelector('p')?.hasAttribute('onclick')).toBe(false);
  });

  it('keeps MediaWiki/raw and OCR HTML on compatibility preparation', () => {
    const mediaWiki = prepareHtmlDocument({
      html: '<nav>Chrome</nav><div id="mw-content-text"><div class="mw-parser-output"><p>Article</p></div></div>',
      kind: 'raw-html',
      title: 'Wiki',
      baseUrl: 'https://en.wikipedia.org/wiki/Test',
      preserveImages: true,
    });
    expect(mediaWiki).toContain('Article');
    expect(mediaWiki).not.toContain('Chrome');

    const ocr = prepareHtmlDocument({
      html: '<div class="page"><div class="page-content">OCR page</div></div>',
      kind: 'ocr-html',
      title: 'OCR',
      baseUrl: 'https://example.com/',
      preserveImages: true,
    });
    expect(ocr).toContain('page-content');
  });

  it('does not mutate legacy arXiv content, metadata, or stored anchor inputs', () => {
    const html = '<article class="ltx_document"><p id="legacy-anchor">Legacy <strong>body</strong></p></article>';
    const metadata = {
      arxivId: '2410.1',
      htmlUrl: 'https://arxiv.org/html/2410.1',
      source: 'https://arxiv.org/abs/2410.1',
    };
    const metadataBefore = JSON.stringify(metadata);
    const prepared = prepareHtmlDocument({
      html,
      kind: 'legacy-arxiv',
      title: 'Legacy',
      baseUrl: metadata.htmlUrl,
      preserveImages: true,
    });
    expect(html).toContain('legacy-anchor');
    expect(JSON.stringify(metadata)).toBe(metadataBefore);
    expect(prepared).toContain('Legacy');
    expect(prepared).toContain('<strong>body</strong>');
  });
});
