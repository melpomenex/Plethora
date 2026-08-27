import { describe, expect, it } from 'vitest';
import { arxivHtmlAssetBase, parseArxivInput, resolveImportSource } from '../arxivResolver';

describe('arxivResolver', () => {
  it('parses html, abs, pdf, and bare IDs with versions', () => {
    expect(parseArxivInput('2410.07524')?.paperId).toBe('2410.07524');
    expect(parseArxivInput('2410.07524v1')?.version).toBe(1);
    expect(parseArxivInput('https://arxiv.org/html/2410.07524v1')?.htmlUrl).toBe(
      'https://arxiv.org/html/2410.07524v1'
    );
    expect(parseArxivInput('https://arxiv.org/abs/2410.07524')?.absUrl).toContain('/abs/2410.07524');
    expect(parseArxivInput('https://arxiv.org/pdf/2410.07524.pdf')?.pdfUrl).toContain('.pdf');
  });

  it('rewrites abs URLs to structured HTML fetch targets', () => {
    const resolved = resolveImportSource('https://arxiv.org/abs/2410.07524v1');
    expect(resolved.classification).toBe('arxiv');
    expect(resolved.fetchUrl).toBe('https://arxiv.org/html/2410.07524v1');
    expect(resolved.canonicalUrl).toBe('https://arxiv.org/abs/2410.07524v1');
  });

  it('returns the fetch URL verbatim as the import asset base (no slash hack)', () => {
    const resolved = resolveImportSource('https://arxiv.org/abs/2410.07524v1');
    expect(resolved.assetBaseUrl).toBe('https://arxiv.org/html/2410.07524v1');
    expect(resolved.assetBaseUrl.endsWith('/')).toBe(false);
    // Versionless entry points keep their verbatim shape too.
    const versionless = resolveImportSource('2410.07524');
    expect(versionless.assetBaseUrl).toBe('https://arxiv.org/html/2410.07524');
  });

  it('keeps arxivHtmlAssetBase only as the legacy reader repair', () => {
    expect(arxivHtmlAssetBase('https://arxiv.org/html/2410.07524v1')).toBe(
      'https://arxiv.org/html/2410.07524v1/'
    );
  });
});
