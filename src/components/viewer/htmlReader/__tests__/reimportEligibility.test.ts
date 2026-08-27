import { describe, expect, it } from 'vitest';
import { isReimportFromSourceEligible } from '../reimportEligibility';
import type { Document } from '../../../../types/document';

type EligibleDoc = Pick<Document, 'fileType' | 'metadata'>;

const html = (metadata: Document['metadata']): EligibleDoc => ({
  fileType: 'html',
  metadata,
});

describe('isReimportFromSourceEligible', () => {
  it('offers the repair for canonical articles and raw-fallback imports', () => {
    const doc = html({ webArticle: { resolvedUrl: 'https://arxiv.org/html/2410.1' } } as Document['metadata']);
    expect(isReimportFromSourceEligible(doc, 'canonical-article')).toBe(true);
    expect(isReimportFromSourceEligible(doc, 'canonical-raw-fallback')).toBe(true);
  });

  it('offers the repair for legacy arXiv documents with a stored source URL', () => {
    expect(isReimportFromSourceEligible(html({ htmlUrl: 'https://arxiv.org/html/2410.1' }), 'legacy-arxiv')).toBe(true);
    expect(isReimportFromSourceEligible(html({ arxivUrl: 'https://arxiv.org/abs/2410.1' }), 'legacy-arxiv')).toBe(true);
    expect(isReimportFromSourceEligible(html({ source: 'https://arxiv.org/abs/2410.1' }), 'legacy-arxiv')).toBe(true);
  });

  it('never offers the repair without a usable stored URL, for other kinds, or non-HTML files', () => {
    expect(isReimportFromSourceEligible(html({}), 'legacy-arxiv')).toBe(false);
    expect(
      isReimportFromSourceEligible(html({ source: 'https://example.com/a' }), 'raw-html')
    ).toBe(false);
    expect(
      isReimportFromSourceEligible(html({ source: 'https://example.com/a' }), 'browser-capture')
    ).toBe(false);
    expect(
      isReimportFromSourceEligible(
        { fileType: 'pdf', metadata: { source: 'https://example.com/a.pdf' } },
        'canonical-article'
      )
    ).toBe(false);
    expect(isReimportFromSourceEligible(null, 'canonical-article')).toBe(false);
  });
});
