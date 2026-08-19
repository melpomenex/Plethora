/**
 * X/Twitter status-URL parsing shared by the store and the viewer.
 *
 * Mirrors the Rust backend's `extract_tweet_id` / `extract_screen_name_from_url`
 * / `build_status_url` (`src-tauri/src/twitter.rs`) so the frontend's status-id
 * detection and canonical-URL output agree with the retrieval pipeline. Handles
 * optional scheme, `www.`/`mobile.` subdomains, `x.com`/`twitter.com`,
 * `/<user>/status/<id>` and `/i/status/<id>`, query strings, and trailing
 * slashes.
 */

const STATUS_SEGMENT = "status";

/** True when a path segment is the host of an x.com/twitter.com URL
 *  (`x.com`, `twitter.com`, or any subdomain — `www.`, `mobile.`, …). */
function isXHost(part: string): boolean {
  const lower = part.toLowerCase();
  return lower === "x.com" || lower === "twitter.com" || lower.endsWith(".x.com") || lower.endsWith(".twitter.com");
}

/**
 * Extract the numeric status id from an x.com/twitter.com URL
 * (`https://x.com/user/status/123?s=20` → `"123"`). Accepts optional scheme,
 * www/mobile subdomains, `/i/status/`, query strings, trailing slashes, and
 * photo/analytics suffixes. Returns `null` when no id is present or the URL is
 * not an x.com/twitter.com status link.
 */
export function extractXStatusId(input: string | null | undefined): string | null {
  if (!input) return null;
  const noQuery = (input.trim().split("?")[0] ?? "").split("#")[0] ?? "";
  const parts = noQuery.replace(/\/+$/, "").split("/");
  if (!parts.some((p) => isXHost(p))) return null;
  const idx = parts.findIndex((p) => p.toLowerCase() === STATUS_SEGMENT);
  if (idx < 0) return null;
  const id = parts[idx + 1];
  if (!id || !/^\d+$/.test(id)) return null;
  return id;
}

/**
 * Extract the @handle segment from a status URL
 * (`https://x.com/handle/status/123` → `"handle"`). Returns `null` for the
 * generic `/i/status/` redirect format and the bare-host `x.com/status/…`
 * form (neither carries a real handle). Mirrors
 * `extract_screen_name_from_url` in the Rust backend.
 */
export function extractXScreenName(input: string | null | undefined): string | null {
  if (!input) return null;
  const noQuery = input.trim().split("?")[0] ?? "";
  const parts = noQuery.replace(/\/+$/, "").split("/");
  const idx = parts.findIndex((p) => p.toLowerCase() === STATUS_SEGMENT);
  if (idx <= 0) return null;
  const handle = parts[idx - 1];
  if (
    !handle ||
    handle === "i" ||
    handle.toLowerCase() === "x.com" ||
    handle.toLowerCase() === "twitter.com" ||
    handle.length > 64 ||
    !/^[A-Za-z0-9_]+$/.test(handle)
  ) {
    return null;
  }
  return handle;
}

/** Build the canonical status URL: `https://x.com/<screen_name>/status/<id>`. */
export function buildCanonicalStatusUrl(screenName: string, id: string): string {
  return `https://x.com/${screenName}/status/${id}`;
}

/** True when the URL looks like an x.com/twitter.com status link. */
export function isXStatusUrl(input: string | null | undefined): boolean {
  return extractXStatusId(input) !== null;
}
