/**
 * Logical URL scheme for persisted canonical article image resources.
 *
 * Stored HTML uses `plethora-asset://{uuid}` — resolved to render URLs at
 * display time, never baked into persisted content as filesystem paths.
 */

export const PLETHORA_ASSET_PROTOCOL = "plethora-asset:";

export function toArticleAssetUrl(assetId: string): string {
  const trimmed = assetId.trim();
  if (!trimmed) throw new Error("Article asset id is required");
  return `${PLETHORA_ASSET_PROTOCOL}//${encodeURIComponent(trimmed)}`;
}

export function parseArticleAssetUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith(PLETHORA_ASSET_PROTOCOL)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== PLETHORA_ASSET_PROTOCOL) return null;
    const id = decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\//, ""));
    return id || null;
  } catch {
    return null;
  }
}

export function isArticleAssetUrl(url: string): boolean {
  return parseArticleAssetUrl(url) !== null;
}

/** Collect unique asset ids referenced by img[src] in article HTML. */
export function extractArticleAssetIds(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set<string>();
  doc.querySelectorAll("img[src]").forEach((img) => {
    const id = parseArticleAssetUrl(img.getAttribute("src") ?? "");
    if (id) ids.add(id);
  });
  return [...ids];
}
