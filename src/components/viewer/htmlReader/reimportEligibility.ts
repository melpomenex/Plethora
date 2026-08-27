import type { Document } from '../../../types/document';
import type { HtmlReaderKind } from './documentKind';

/**
 * Eligibility for the explicit "Re-import from source" repair action
 * (fix-imported-html-resource-resolution D6):
 *
 * - canonical articles and raw-fallback imports (webArticle provenance);
 * - legacy arXiv HTML documents with a stored http(s) source URL.
 *
 * The action is never offered (and never invoked) for anything else — no
 * automatic re-import exists anywhere.
 */
export function isReimportFromSourceEligible(
  document: Pick<Document, 'fileType' | 'metadata'> | null | undefined,
  readerKind: HtmlReaderKind
): boolean {
  if (!document || document.fileType !== 'html') return false;
  if (readerKind === 'canonical-article' || readerKind === 'canonical-raw-fallback') {
    return true;
  }
  if (readerKind === 'legacy-arxiv') {
    const meta = document.metadata;
    return Boolean(
      meta?.htmlUrl?.startsWith('http') ||
        meta?.arxivUrl?.startsWith('http') ||
        meta?.source?.startsWith('http')
    );
  }
  return false;
}
