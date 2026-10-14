/** Durable source rules, matching models/capture.rs (never semantic tags). */
export function validCaptureUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

export function browserCaptureSourceUrl(metadata: unknown, filePath: unknown): string | null {
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { return null; }
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const meta = metadata as Record<string, unknown>;
  const provenance = meta.captureProvenance as Record<string, unknown> | undefined;
  const origin = provenance?.source;
  const isBrowser = origin === "browser_extension" || (
    origin !== "android_share" && origin !== "share_extension" &&
    meta.shareProvenance == null && meta.source === "browser_extension"
  );
  if (!isBrowser) return null;
  const context = meta.browserCaptureContext as Record<string, unknown> | undefined;
  const article = meta.webArticle as Record<string, unknown> | undefined;
  for (const candidate of [provenance?.sourceUrl, context?.sourceUrl, context?.url, meta.originalUrl, meta.url, article?.originalUrl, filePath]) {
    const url = validCaptureUrl(candidate);
    if (url) return url;
  }
  return null;
}
