/**
 * DOMPurify sanitization boundary (design D6).
 *
 * The persisted article is produced ONLY through this module: an explicit
 * semantic allowlist plus an after-sanitize URL policy. Whatever the
 * normalizer missed, the sanitizer drops; the tests prove the boundary, not
 * the good faith of earlier stages.
 */

import { loadDomPurify } from './engineLoader';

export interface SanitizationReport {
  droppedTags: number;
  droppedAttributes: number;
  droppedUrls: number;
  droppedImages: number;
}

export interface SanitizeResult {
  html: string;
  report: SanitizationReport;
}

/** Semantic HTML allowlist (design D6). Everything else — script, style,
 * iframe, object, embed, form controls, link, meta, base, noscript, svg,
 * template, frames — is dropped, children preserved where semantic. */
const ALLOWED_TAGS = [
  // Prose structure
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'b', 'i', 's', 'u', 'a', 'br', 'hr', 'small', 'sup', 'sub',
  'abbr', 'time', 'mark', 'cite', 'q', 'dfn', 'kbd', 'samp', 'var',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Quotes / figures / media
  'blockquote', 'figure', 'figcaption', 'img',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Code
  'pre', 'code',
  // Article scaffolding (normalizer-emitted hooks)
  'article', 'header', 'div',
  // MathML
  'math', 'semantics', 'annotation', 'annotation-xml', 'maction', 'menclose',
  'merror', 'mfrac', 'mi', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded',
  'mphantom', 'mprescripts', 'mroot', 'mrow', 'ms', 'mspace', 'msqrt', 'mstyle',
  'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder',
  'munderover',
];

/** The only class tokens that may survive sanitization: the pipeline's own
 * structural hooks (inc-*) — reader styling hooks and the raw-fallback
 * notice. Publisher classes are never inc-prefixed, so this filter cannot
 * pass site styling through. */
const INC_CLASS_TOKENS = new Set([
  'inc-article',
  'inc-raw',
  'inc-publication',
  'inc-title',
  'inc-dek',
  'inc-byline',
  'inc-hero',
  'inc-body',
  'inc-raw-notice',
]);

/** Attribute allowlist — no style, no data-*, no event handlers (DOMPurify
 * strips on* by default even if listed). `class` is allowlisted but the
 * after-sanitize hook filters it down to INC_CLASS_TOKENS only. */
const ALLOWED_ATTR = [
  // Global semantics only
  'lang', 'dir', 'class',
  // Anchors
  'href', 'title', 'rel',
  // Images
  'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding',
  'referrerpolicy',
  // Quotes
  'cite',
  // Tables
  'colspan', 'rowspan', 'scope', 'headers',
  // Lists
  'start', 'type',
  // Time
  'datetime',
  // MathML presentational attributes (names shared with HTML above are fine)
  'display', 'mathvariant', 'encoding', 'notation', 'linethickness', 'stretchy',
  'fence', 'separator', 'lspace', 'rspace', 'largeop', 'movablelimits',
  'columnalign', 'rowalign', 'columnlines', 'rowlines', 'frame', 'rowspacing',
  'columnspacing', 'open', 'close', 'accent', 'accentunder', 'role',
];

function isAllowedLinkScheme(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('#')) return true; // in-document fragment
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    // Relative URLs resolve later against the canonical base; they pass here
    // and the reader re-resolves them at display time.
    return /^[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/i.test(trimmed) && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  }
}

function isAllowedMediaScheme(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('#')) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  }
}

/** Sanitize normalized article HTML to the persisted representation. */
export async function sanitizeArticleHtml(html: string): Promise<SanitizeResult> {
  const mod = await loadDomPurify();
  const DOMPurify: typeof import('dompurify').default =
    (mod as { default?: typeof import('dompurify').default }).default ??
    (mod as unknown as typeof import('dompurify').default);

  const report: SanitizationReport = {
    droppedTags: 0,
    droppedAttributes: 0,
    droppedUrls: 0,
    droppedImages: 0,
  };

  // Count what the allowlist removes (DOMPurify reports removals via hooks is
  // awkward for tags; compare node inventory before/after instead).
  const before = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const countTags = (doc: Document): number => doc.querySelectorAll('*').length;
  const beforeTags = countTags(before);
  const beforeAttrs = Array.from(before.querySelectorAll('*')).reduce(
    (n, el) => n + el.attributes.length,
    0
  );

  const afterSanitizeAttributes = (node: Element): void => {
    // class: keep only pipeline-emitted inc-* structural hooks.
    if (node.hasAttribute('class')) {
      const kept = (node.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((token) => INC_CLASS_TOKENS.has(token));
      if (kept.length > 0) {
        node.setAttribute('class', kept.join(' '));
      } else {
        node.removeAttribute('class');
        report.droppedAttributes += 1;
      }
    }
    const href = node.getAttribute('href');
    if (node.tagName.toLowerCase() === 'a') {
      if (href !== null && !isAllowedLinkScheme(href)) {
        node.removeAttribute('href');
        report.droppedUrls += 1;
      }
      if (node.hasAttribute('href')) {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
    const src = node.getAttribute('src');
    if (src !== null && node.tagName.toLowerCase() !== 'a') {
      if (!isAllowedMediaScheme(src)) {
        node.removeAttribute('src');
        report.droppedUrls += 1;
      }
    }
    const cite = node.getAttribute('cite');
    if (cite !== null && !isAllowedLinkScheme(cite)) {
      node.removeAttribute('cite');
      report.droppedUrls += 1;
    }
  };

  DOMPurify.addHook('afterSanitizeAttributes', afterSanitizeAttributes);
  let cleaned: string;
  try {
    cleaned = DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true, // drop disallowed elements, keep their text children
      FORBID_TAGS: ['style', 'svg', 'template', 'noscript', '#comment'],
      // Reader re-parses; forbid anything executable by construction.
      SANITIZE_DOM: true,
      WHOLE_DOCUMENT: false,
      RETURN_TRUSTED_TYPE: false,
    }) as string;
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
  }

  // Post pass: remove imgs whose src the URL policy dropped (a broken img is
  // worse than none), and count tag/attribute deltas.
  const afterDoc = new DOMParser().parseFromString(`<div>${cleaned}</div>`, 'text/html');
  afterDoc.querySelectorAll('img:not([src])').forEach((img) => {
    img.remove();
    report.droppedImages += 1;
  });
  const afterTags = countTags(afterDoc);
  const afterAttrs = Array.from(afterDoc.querySelectorAll('*')).reduce(
    (n, el) => n + el.attributes.length,
    0
  );
  report.droppedTags = Math.max(0, beforeTags - afterTags);
  report.droppedAttributes = Math.max(0, beforeAttrs - afterAttrs);

  // afterDoc.body holds the <div> wrapper we parsed; its innerHTML is the
  // sanitized (and img-pruned) content without the wrapper.
  const finalHtml = afterDoc.body.firstElementChild
    ? afterDoc.body.firstElementChild.innerHTML
    : cleaned;
  return { html: finalHtml, report };
}
