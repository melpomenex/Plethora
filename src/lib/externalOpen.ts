/**
 * Normalize desktop external-open events into SharedBatch for the import router.
 */

import type { ExternalOpenPayload } from "../types/externalOpen";
import type { SharedBatch, SharedItem } from "../types/share";
import { PLETHORA_AUTH_CALLBACK_URI } from "../config/product";
import { normalizeArticleUrl } from "../utils/articleImport/urlNormalizer";

/** Deep links handled elsewhere (auth callback route, occlusion composer). */
export function isInternallyRoutedDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "plethora:") return false;
    if (url.startsWith(PLETHORA_AUTH_CALLBACK_URI)) return true;
    if (parsed.hostname === "auth") return true;
    if (parsed.hostname === "occlusion") return true;
    return false;
  } catch {
    return false;
  }
}

export function externalOpenToSharedBatch(
  payload: ExternalOpenPayload,
): SharedBatch | null {
  const timestamp = Date.now();
  switch (payload.kind) {
    case "files": {
      const items: SharedItem[] = payload.paths
        .filter((p) => typeof p === "string" && p.length > 0)
        .map((filePath) => {
          const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
          return { type: "file" as const, filePath, fileName };
        });
      return items.length > 0 ? { timestamp, items } : null;
    }
    case "deepLink": {
      if (isInternallyRoutedDeepLink(payload.url)) {
        return null;
      }
      // Generic plethora:// links that look like web URLs in the path.
      try {
        const parsed = new URL(payload.url);
        const asHttp = parsed.searchParams.get("url");
        if (asHttp) {
          const normalized = normalizeArticleUrl(asHttp);
          if (normalized.valid && normalized.normalized) {
            return {
              timestamp,
              items: [{ type: "url", url: normalized.normalized }],
            };
          }
        }
      } catch {
        // fall through
      }
      return {
        timestamp,
        items: [{ type: "url", url: payload.url }],
      };
    }
    default:
      return null;
  }
}
