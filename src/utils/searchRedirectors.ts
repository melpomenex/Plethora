/**
 * Search-engine redirector unwrapping.
 *
 * Search result pages link through redirector URLs (`google.com/url?q=…`,
 * `duckduckgo.com/l/?uddg=…`, `bing.com/ck/a?u=…`). Loading the redirector in
 * the embedded browser renders an interstitial (Google's cookie-less
 * "Redirect Notice") instead of the result. Unwrapping extracts the target
 * URL before navigation; the target then flows through the exact same
 * validation and loopback-proxy fetch as any direct navigation — no security
 * surface is widened.
 *
 * The table is data-driven so new engines are one entry away. Unknown or
 * malformed redirectors fall back to the original URL.
 */

interface RedirectorRule {
  /** Host the rule matches (compared case-insensitively, `www.` ignored). */
  host: string;
  /** Path the rule matches (prefix match when it ends with `/`). */
  path: string;
  /** Search-param keys tried in order for the target URL. */
  paramKeys: string[];
  /** The param value is base64url-encoded (Bing's `u=a1<base64>`). */
  base64url?: boolean;
}

const REDIRECTOR_RULES: RedirectorRule[] = [
  { host: "google.com", path: "/url", paramKeys: ["q", "url"] },
  { host: "google.com", path: "/imgres", paramKeys: ["imgurl", "imgrefurl"] },
  { host: "duckduckgo.com", path: "/l/", paramKeys: ["uddg"] },
  { host: "bing.com", path: "/ck/", paramKeys: ["u"], base64url: true },
];

function decodeBase64UrlUtf8(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function httpUrlOrNull(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Return the direct target of a known search-engine redirector URL, or the
 * original URL when nothing can be safely extracted. The result is always a
 * well-formed absolute http(s) URL or the untouched input.
 */
export function unwrapSearchRedirector(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname;

  for (const rule of REDIRECTOR_RULES) {
    if (rule.host !== host) continue;
    const pathMatches = rule.path.endsWith("/")
      ? path.startsWith(rule.path)
      : path === rule.path;
    if (!pathMatches) continue;

    for (const key of rule.paramKeys) {
      const value = parsed.searchParams.get(key);
      if (!value) continue;

      let candidate: string | null = value;
      if (rule.base64url) {
        // Bing prefixes the base64url payload with a variant byte ("a1…").
        const payload = value.length > 2 && /^[a-z]\d/.test(value) ? value.slice(2) : value;
        candidate = decodeBase64UrlUtf8(payload);
      }
      if (!candidate) continue;

      const target = httpUrlOrNull(candidate);
      if (target) return target;
    }
    // A redirector whose params carry no usable target falls back to the
    // original URL rather than an empty navigation.
    return rawUrl;
  }

  return rawUrl;
}
