/**
 * Image normalization for the winning article candidate (design D8).
 *
 * Resolves lazy-load attributes and srcset/<picture> to a single best absolute
 * URL, rejects tracking pixels and repeated chrome/logo images, and stamps the
 * reader-convention attributes (no-referrer, eager, async decoding). Reading
 * order is never changed — images stay exactly where they were extracted.
 */

import {
  IMAGE_MAX_WIDTH,
  LAZY_SRC_ATTRIBUTES,
  REPEATED_IMAGE_MIN,
  TRACKING_PIXEL_MAX,
} from './extractor-config';

export interface ImageNormalizationReport {
  droppedImages: number;
  warnings: string[];
}

interface SrcsetCandidate {
  url: string;
  /** Effective width in px; 0 when unknown. */
  width: number;
}

/** Parse a srcset attribute into candidates. Handles `w` descriptors and,
 * when no `w` exists, derives a nominal width from `x` descriptors. */
export function parseSrcset(srcset: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  for (const part of srcset.split(',')) {
    const segments = part.trim().split(/\s+/);
    if (segments.length === 0 || !segments[0]) continue;
    const url = segments[0];
    let width = 0;
    if (segments.length > 1) {
      const descriptor = segments[1];
      if (descriptor.endsWith('w')) {
        width = parseInt(descriptor, 10) || 0;
      } else if (descriptor.endsWith('x')) {
        const dpr = parseFloat(descriptor) || 1;
        width = Math.round(1000 * dpr);
      }
    }
    out.push({ url, width });
  }
  return out;
}

/** Best candidate: the largest width ≤ IMAGE_MAX_WIDTH, else the largest
 * overall (deterministic tie-break by first occurrence). */
export function bestSrcsetCandidate(candidates: SrcsetCandidate[]): SrcsetCandidate | null {
  if (candidates.length === 0) return null;
  const withinCap = candidates.filter((c) => c.width > 0 && c.width <= IMAGE_MAX_WIDTH);
  const pool = withinCap.length > 0 ? withinCap : candidates;
  let best = pool[0];
  for (const c of pool) {
    if (c.width > best.width) best = c;
  }
  return best;
}

function absolutize(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Best raw source among an image's lazy-load attributes, srcset, and src.
 * Lazy attributes win (lazy `src` values are placeholders); srcset beats a
 * plain `src` for the same reason; data: URLs are placeholders, rejected. */
function resolveRawSrc(img: HTMLImageElement): string | null {
  for (const attr of LAZY_SRC_ATTRIBUTES) {
    const value = img.getAttribute(attr);
    if (value && !value.startsWith('data:')) return value;
  }
  const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
  if (srcset) {
    const best = bestSrcsetCandidate(parseSrcset(srcset));
    if (best) return best.url;
  }
  const src = img.getAttribute('src');
  if (src && !src.startsWith('data:')) return src;
  return null;
}

function declaredTiny(img: HTMLImageElement): boolean {
  const attrNum = (name: string): number => {
    const v = img.getAttribute(name);
    if (!v) return Number.NaN;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? Number.NaN : n;
  };
  for (const name of ['width', 'height']) {
    const n = attrNum(name);
    if (!Number.isNaN(n) && n >= 0 && n <= TRACKING_PIXEL_MAX) return true;
  }
  for (const name of ['width', 'height']) {
    const style = img.getAttribute('style') ?? '';
    const m = style.match(new RegExp(`${name}\\s*:\\s*(\\d+)`, 'i'));
    if (m && parseInt(m[1], 10) <= TRACKING_PIXEL_MAX) return true;
  }
  return false;
}

/**
 * Normalize every image in `container` (the winning candidate's body).
 * `<picture>` elements collapse to their best `<source>`/`<img>` URL on the
 * img itself; the picture wrapper is kept only when it contains a figcaption
 * sibling (rare) — otherwise the img is hoisted in place.
 */
export function normalizeImages(
  container: HTMLElement,
  baseUrl: string
): ImageNormalizationReport {
  const report: ImageNormalizationReport = { droppedImages: 0, warnings: [] };

  // First pass: resolve each img to its final absolute URL.
  const resolved = new Map<HTMLImageElement, string>();
  container.querySelectorAll('img').forEach((img) => {
    // <picture> sources take precedence when they carry real URLs.
    const picture = img.closest('picture');
    if (picture) {
      const sourceSrcset =
        picture.querySelector<HTMLSourceElement>('source[srcset]')?.getAttribute('srcset') ?? null;
      if (sourceSrcset) {
        const best = bestSrcsetCandidate(parseSrcset(sourceSrcset));
        if (best && isHttpUrl(absolutize(best.url, baseUrl))) {
          resolved.set(img, absolutize(best.url, baseUrl));
          return;
        }
      }
    }
    const raw = resolveRawSrc(img);
    if (!raw) {
      resolved.set(img, '');
      return;
    }
    const absolute = absolutize(raw, baseUrl);
    if (!isHttpUrl(absolute)) {
      resolved.set(img, '');
      return;
    }
    resolved.set(img, absolute);
  });

  // Repeated-source (logo/chrome) detection across the final URLs.
  const counts = new Map<string, number>();
  for (const url of resolved.values()) {
    if (!url) continue;
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }

  // Second pass: drop rejects, stamp conventions on survivors.
  for (const [img, url] of resolved) {
    if (!url || declaredTiny(img) || (counts.get(url) ?? 0) >= REPEATED_IMAGE_MIN) {
      img.remove();
      report.droppedImages += 1;
      continue;
    }
    img.setAttribute('src', url);
    for (const attr of [...LAZY_SRC_ATTRIBUTES, 'srcset', 'data-srcset', 'sizes']) {
      img.removeAttribute(attr);
    }
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.setAttribute('loading', 'eager');
    img.setAttribute('decoding', 'async');
  }

  // Hoist imgs out of <picture> wrappers (srcset/source are stripped by the
  // sanitizer anyway) — keep position exactly.
  container.querySelectorAll('picture').forEach((picture) => {
    const img = picture.querySelector('img');
    if (img) {
      picture.replaceWith(img);
    } else {
      picture.remove();
      report.droppedImages += 1;
    }
  });

  return report;
}

/** Absolutize a metadata hero image URL (og:image etc.) against the page. */
export function absolutizeImageUrl(url: string, baseUrl: string): string {
  return absolutize(url, baseUrl);
}
