/**
 * Production-copy terminology scans for the dist gate
 * (refine-useplethora-visual-product-storytelling, copy-discipline spec).
 *
 * - `findEssayViolations` FAILS the gate: user-facing copy must frame the
 *   reading artifact as a document, never an essay. The documented
 *   generic-genre exemption (e.g. the /readers page's "Books, essays, and
 *   papers" content-type listing) is expressed as route allowlist entries.
 * - `findSurfaceUsages` is REPORT-ONLY: hardware-meaning "surface(s)"
 *   should say device(s), but the word is legitimately overloaded
 *   (verbs, UI areas, drag surfaces), so the gate surfaces occurrences
 *   for review against the technical-use whitelist instead of failing.
 *
 * Both scanners expect markup with <script> bodies already stripped
 * (client-side templates are not served copy).
 */

/** Routes whose visible copy may legitimately use the genre word. */
export const ESSAY_ROUTE_ALLOWLIST = ['/readers'];

/** Routes with historical quotes exempt from copy policing. */
export const HISTORICAL_ROUTE_ALLOWLIST = ['/changelog'];

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const ESSAY_WORD = /\bessays?\b/gi;
const SURFACE_WORD = /\bsurfaces?\b/gi;

function stripScripts(html) {
  // Remove non-copy regions first (client templates, CSS tokens), then drop
  // tags so attribute names like data-surface never read as visible copy.
  return html.replace(SCRIPT_BLOCK, '').replace(STYLE_BLOCK, '').replace(/<[^>]*>/g, ' ');
}

function relativeRoute(filePath) {
  const normalized = filePath.split('\\').join('/');
  const marker = '/dist/';
  const index = normalized.lastIndexOf(marker);
  const withinDist = index >= 0 ? normalized.slice(index + marker.length) : normalized;
  const withoutIndex = withinDist.replace(/(^|\/)index\.html$/, '$1');
  return `/${withoutIndex.replace(/\/$/, '')}`.replace('//', '/');
}

/**
 * @returns {Array<{ route: string, word: string, context: string }>}
 *   Essay occurrences that are NOT covered by the genre allowlist.
 */
export function findEssayViolations(html, filePath) {
  const route = relativeRoute(filePath);
  if (
    ESSAY_ROUTE_ALLOWLIST.some((allowed) => route === allowed || route.startsWith(`${allowed}/`)) ||
    HISTORICAL_ROUTE_ALLOWLIST.some((allowed) => route === allowed || route.startsWith(`${allowed}/`))
  ) {
    return [];
  }
  const violations = [];
  const markup = stripScripts(html);
  for (const match of markup.matchAll(ESSAY_WORD)) {
    const start = Math.max(0, match.index - 60);
    violations.push({
      route,
      word: match[0],
      context: markup.slice(start, match.index + match[0].length + 60).replace(/\s+/g, ' '),
    });
  }
  return violations;
}

/**
 * @returns {Array<{ route: string, word: string, context: string }>}
 *   Every surface(s) occurrence for review — never a failure by itself.
 */
export function findSurfaceUsages(html, filePath) {
  const route = relativeRoute(filePath);
  const usages = [];
  const markup = stripScripts(html);
  for (const match of markup.matchAll(SURFACE_WORD)) {
    const start = Math.max(0, match.index - 60);
    usages.push({
      route,
      word: match[0],
      context: markup.slice(start, match.index + match[0].length + 60).replace(/\s+/g, ' '),
    });
  }
  return usages;
}
