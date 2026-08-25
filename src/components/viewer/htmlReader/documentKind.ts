import type { DocumentMetadata } from '../../../types/document';

export type HtmlReaderKind =
  | 'canonical-article'
  | 'canonical-raw-fallback'
  | 'legacy-arxiv'
  | 'browser-capture'
  | 'ocr-html'
  | 'raw-html';

export interface HtmlReaderClassificationInput {
  fileType?: string;
  metadata?: DocumentMetadata;
  html: string;
  surface?: 'document' | 'ocr-html';
}

export interface HtmlReaderClassification {
  kind: HtmlReaderKind;
  diagnostics: string[];
  hasCanonicalStructure: boolean;
}

function hasCanonicalStructure(html: string): boolean {
  if (!html.trim()) return false;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const articles = doc.querySelectorAll('article.inc-article');
  return (
    articles.length === 1 &&
    articles[0].querySelectorAll(':scope > .inc-body').length === 1
  );
}

/** Classify persisted HTML using provenance first and structure as a guard. */
export function classifyHtmlReader(
  input: HtmlReaderClassificationInput
): HtmlReaderClassification {
  if (input.surface === 'ocr-html') {
    return { kind: 'ocr-html', diagnostics: [], hasCanonicalStructure: false };
  }

  const diagnostics: string[] = [];
  const canonicalStructure = hasCanonicalStructure(input.html);
  const provenance = input.metadata?.webArticle;
  const claimsCanonical = input.fileType === 'html' && provenance !== undefined;

  if (claimsCanonical) {
    if (!canonicalStructure) {
      diagnostics.push(
        'Canonical web-article provenance did not match the required .inc-article > .inc-body structure.'
      );
      return { kind: 'raw-html', diagnostics, hasCanonicalStructure: false };
    }
    const doc = new DOMParser().parseFromString(input.html, 'text/html');
    const rawMarker = doc.querySelector('article.inc-article.inc-raw') !== null;
    if (provenance.extractor === 'raw-fallback' || rawMarker) {
      return {
        kind: 'canonical-raw-fallback',
        diagnostics,
        hasCanonicalStructure: true,
      };
    }
    return { kind: 'canonical-article', diagnostics, hasCanonicalStructure: true };
  }

  if (canonicalStructure) {
    diagnostics.push('Canonical-looking classes were ignored because persisted provenance was absent.');
  }

  if (input.metadata?.source === 'browser_extension') {
    return { kind: 'browser-capture', diagnostics, hasCanonicalStructure: canonicalStructure };
  }
  if (
    input.metadata?.webArticle === undefined &&
    Boolean(input.metadata?.arxivId) &&
    Boolean(input.metadata?.htmlUrl)
  ) {
    return { kind: 'legacy-arxiv', diagnostics, hasCanonicalStructure: canonicalStructure };
  }
  return { kind: 'raw-html', diagnostics, hasCanonicalStructure: canonicalStructure };
}

