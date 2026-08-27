/**
 * Effective resource-base resolution for imported HTML (fix-imported-html-
 * resource-resolution design D1).
 *
 * Every surface that resolves a relative imported media URL — canonical
 * pipeline, raw-page fallback, rendered fallback, import-dialog preview, and
 * reader repair — must resolve against ONE base, selected by standards
 * precedence:
 *
 *   1. a safe `<base href>` declared by the fetched document (absolute
 *      http(s) URLs only);
 *   2. the redirect-resolved final document URL, verbatim;
 *   3. the requested URL, verbatim.
 *
 * Canonical-link / og:url / JSON-LD URLs are article IDENTITY, never resource
 * bases, and bases are never mutated by host-specific path edits (trailing
 * slashes et al.) — verbatim document-URL semantics reproduce exactly what
 * the source browser resolved.
 */

export type ResourceBaseSource = 'doc-base' | 'final' | 'requested';

export interface EffectiveResourceBase {
  /** The base every relative media URL in the document resolves against. */
  base: string;
  /** Which precedence rule produced the base (diagnostics). */
  source: ResourceBaseSource;
}

export interface ResolveResourceBaseInput {
  /** What the caller asked to fetch (post adapter rewriting). */
  requestedUrl: string;
  /** Redirect-resolved URL reported by the transport, when known. */
  finalUrl?: string;
  /** `<base href>` of the fetched document, if any. */
  docBaseHref?: string | null;
}

function parseHttpUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective resource base for one fetched document.
 *
 * A `<base href>` qualifies only when it is an absolute http(s) URL on its
 * own: relative-only (`assets/`, `/assets/`, `//host/assets/`) and non-http(s)
 * (`javascript:`, `file:`, `data:`) base hrefs are ignored, and the document
 * URL is used verbatim instead.
 */
export function resolveEffectiveResourceBase(
  input: ResolveResourceBaseInput
): EffectiveResourceBase {
  const finalUrl = parseHttpUrl(input.finalUrl);
  const requestedUrl = parseHttpUrl(input.requestedUrl);
  const anchor = finalUrl ?? requestedUrl;

  if (anchor) {
    const docBase = parseHttpUrl(input.docBaseHref);
    if (docBase) {
      return { base: docBase.toString(), source: 'doc-base' };
    }
    // Verbatim: no slash appending, no path editing. URL serialization only
    // normalizes case/encoding, never the path shape.
    return {
      base: anchor.toString(),
      source: finalUrl ? 'final' : 'requested',
    };
  }

  // Neither URL parses as http(s) (defensive — the pipeline normalizes its
  // inputs before fetching). Hand back the requested value untouched so
  // callers degrade the same way they did before this helper existed.
  return { base: input.requestedUrl, source: 'requested' };
}

/** Read the first usable `<base href>` of a fetched document (null when the
 * document declares none or declares only whitespace). */
export function docBaseHref(doc: Document): string | null {
  const href = doc.querySelector('base[href]')?.getAttribute('href');
  if (!href) return null;
  const trimmed = href.trim();
  return trimmed ? trimmed : null;
}

/** Remove `<base>` elements before engine extraction and persistence: engines
 * infer their own bases and persisted HTML must never depend on one. */
export function stripBaseElements(root: Document | Element): void {
  root.querySelectorAll('base').forEach((element) => element.remove());
}
