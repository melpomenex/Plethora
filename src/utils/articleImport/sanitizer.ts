/**
 * DOMPurify sanitization boundary (design D6).
 *
 * The persisted article is produced ONLY through this module: an explicit
 * semantic allowlist plus an after-sanitize URL policy. Whatever the
 * normalizer missed, the sanitizer drops; the tests prove the boundary, not
 * the good faith of earlier stages.
 */

import { loadDomPurify } from './engineLoader';
import {
  isAllowedScholarlyAccessibilityAttribute,
  isGeneratedScholarlyId,
  isScholarlyClassToken,
} from './scholarlyContract';

export interface SanitizationReport {
  droppedTags: number;
  droppedAttributes: number;
  droppedUrls: number;
  droppedImages: number;
}

export interface SanitizeResult {
  html: string;
  report: SanitizationReport;
  warnings: string[];
}

/** Semantic HTML allowlist (design D6). Everything else — script, style,
 * iframe, object, embed, form controls, link, meta, base, noscript, svg,
 * template, frames — is dropped, children preserved where semantic. */
const ALLOWED_TAGS = [
  // Prose structure
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'b', 'i', 's', 'u', 'a', 'span', 'br', 'hr', 'small', 'sup', 'sub',
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
  'article', 'header', 'section', 'div',
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
/** Attribute allowlist — no style, no data-*, no event handlers (DOMPurify
 * strips on* by default even if listed). `class`, generated `id`, and the two
 * accessibility attributes are filtered again by the post hook. */
const ALLOWED_ATTR = [
  // Global semantics only
  'lang', 'dir', 'class', 'id', 'aria-label', 'aria-labelledby',
  // Anchors
  'href', 'title', 'rel',
  // Images
  'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding',
  'referrerpolicy',
  // Quotes
  'cite',
  // Tables
  'colspan', 'rowspan', 'scope',
  // Lists
  'start', 'type',
  // Time
  'datetime',
  // MathML presentational attributes (names shared with HTML above are fine)
  'display', 'mathvariant', 'encoding', 'notation', 'linethickness', 'stretchy',
  'fence', 'separator', 'lspace', 'rspace', 'largeop', 'movablelimits',
  'columnalign', 'rowalign', 'columnlines', 'rowlines', 'frame', 'rowspacing',
  'columnspacing', 'open', 'close', 'accent', 'accentunder',
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
  const warnings: string[] = [];

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
        .filter(isScholarlyClassToken);
      if (kept.length > 0) {
        node.setAttribute('class', kept.join(' '));
      } else {
        node.removeAttribute('class');
        report.droppedAttributes += 1;
      }
    }

    const id = node.getAttribute('id');
    if (id !== null && !isGeneratedScholarlyId(id)) {
      node.removeAttribute('id');
      report.droppedAttributes += 1;
    }

    for (const attribute of ['aria-label', 'aria-labelledby'] as const) {
      const value = node.getAttribute(attribute);
      if (
        value !== null &&
        !isAllowedScholarlyAccessibilityAttribute(node, attribute, value)
      ) {
        node.removeAttribute(attribute);
        report.droppedAttributes += 1;
      }
    }

    const href = node.getAttribute('href');
    if (node.tagName.toLowerCase() === 'a') {
      const unsafeFragment =
        href?.startsWith('#') && !isGeneratedScholarlyId(href.slice(1));
      if (href !== null && (unsafeFragment || !isAllowedLinkScheme(href))) {
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
      ALLOW_ARIA_ATTR: false,
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

  // Validate generated relationships against the DOM that actually survived
  // DOMPurify. Visible anchor text is retained when a relationship is lost.
  const targets = new Map<string, Element>();
  afterDoc.querySelectorAll<HTMLElement>('[id]').forEach((target) => {
    if (!isGeneratedScholarlyId(target.id) || targets.has(target.id)) {
      const removed = target.id;
      target.removeAttribute('id');
      warnings.push(`removed malformed or duplicate scholarly target: ${removed}`);
      return;
    }
    targets.set(target.id, target);
  });
  afterDoc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    const targetId = anchor.getAttribute('href')!.slice(1);
    if (!isGeneratedScholarlyId(targetId) || !targets.has(targetId)) {
      anchor.removeAttribute('href');
      anchor.removeAttribute('rel');
      report.droppedUrls += 1;
      warnings.push(`removed scholarly fragment without a surviving target: ${targetId}`);
    }
  });
  afterDoc.querySelectorAll<HTMLElement>('[aria-labelledby]').forEach((element) => {
    const targetId = element.getAttribute('aria-labelledby') ?? '';
    if (!isGeneratedScholarlyId(targetId) || !targets.has(targetId)) {
      element.removeAttribute('aria-labelledby');
      warnings.push(`removed scholarly aria-labelledby without a surviving target: ${targetId}`);
    }
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
  return { html: finalHtml, report, warnings };
}
