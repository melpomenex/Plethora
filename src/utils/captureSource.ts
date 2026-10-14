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

const NATIVE_SHARE_ORIGINS = new Set(["share_extension", "android_share"]);

/** Durable share evidence only; tags, URLs, file types and collections are not evidence. */
export function hasShareCaptureEvidence(metadata: unknown): boolean {
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { return false; }
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  const capture = meta.captureProvenance;
  const captureSource = capture && typeof capture === "object" && !Array.isArray(capture)
    ? (capture as Record<string, unknown>).source
    : undefined;
  if (typeof captureSource === "string" && NATIVE_SHARE_ORIGINS.has(captureSource)) return true;
  const source = meta.source;
  if (typeof source === "string" && NATIVE_SHARE_ORIGINS.has(source)) return true;
  return meta.shareProvenance !== null && meta.shareProvenance !== undefined;
}

/** First valid original web URL candidate for a shared document, if any. */
export function shareCaptureSourceUrl(metadata: unknown, filePath: unknown): string | null {
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { return null; }
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const meta = metadata as Record<string, unknown>;
  const share = meta.shareProvenance as Record<string, unknown> | undefined;
  const capture = meta.captureProvenance as Record<string, unknown> | undefined;
  const context = meta.browserCaptureContext as Record<string, unknown> | undefined;
  const article = meta.webArticle as Record<string, unknown> | undefined;
  for (const candidate of [
    share?.sourceUrl,
    share?.originalUrl,
    share?.url,
    capture?.sourceUrl,
    context?.sourceUrl,
    meta.originalUrl,
    meta.url,
    article?.originalUrl,
    filePath,
  ]) {
    const url = validCaptureUrl(candidate);
    if (url) return url;
  }
  return null;
}
