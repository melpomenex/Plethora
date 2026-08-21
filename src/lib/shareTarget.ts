/**
 * Native Mobile and Web Share Target integration.
 *
 * Normalizes incoming share intents from Android / iOS and PWA web share targets
 * into structured SharedBatch payloads.
 */

import { invokeCommand, isTauri } from "./tauri";
import type {
  SharedBatch,
  SharedItem,
  ShareTargetResult,
  StagedShareManifest,
} from "../types/share";
import type { DocumentMetadata } from "../types/document";

/**
 * Normalizes an untyped share event or payload into a structured SharedBatch.
 */
export function normalizeSharedBatch(raw: any): SharedBatch | null {
  if (!raw) return null;

  // Case 1: Structured batch object
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    const items: SharedItem[] = raw.items
      .map((item: any): SharedItem | null => {
        if (!item || typeof item !== "object") return null;
        const type = (item.type || (item.url ? "url" : item.filePath ? "file" : "text")) as SharedItem["type"];
        return {
          type,
          url: typeof item.url === "string" ? item.url : undefined,
          text: typeof item.text === "string" ? item.text : undefined,
          title: typeof item.title === "string" ? item.title : undefined,
          filePath: typeof item.filePath === "string" ? item.filePath : undefined,
          fileName: typeof item.fileName === "string" ? item.fileName : undefined,
          mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
          fileSize: typeof item.fileSize === "number" ? item.fileSize : undefined,
        };
      })
      .filter((item: SharedItem | null): item is SharedItem => item !== null);

    if (items.length > 0) {
      return {
        // Staged-batch id (iOS App Group manifests); undefined for warm-start.
        id: typeof raw.id === "string" ? raw.id : undefined,
        timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
        items,
      };
    }
  }

  // Case 2: Legacy single URL string
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return {
        timestamp: Date.now(),
        items: [{ type: "url", url: trimmed }],
      };
    }
    if (trimmed.length > 0) {
      return {
        timestamp: Date.now(),
        items: [{ type: "text", text: trimmed }],
      };
    }
  }

  // Case 3: Object with url / text / filePath
  if (typeof raw === "object") {
    if (raw.url) {
      return {
        timestamp: Date.now(),
        items: [
          {
            type: "url",
            url: String(raw.url),
            title: raw.title ? String(raw.title) : undefined,
            text: raw.text ? String(raw.text) : undefined,
          },
        ],
      };
    }
    if (raw.filePath) {
      return {
        timestamp: Date.now(),
        items: [
          {
            type: "file",
            filePath: String(raw.filePath),
            fileName: raw.fileName ? String(raw.fileName) : undefined,
            mimeType: raw.mimeType ? String(raw.mimeType) : undefined,
            title: raw.title ? String(raw.title) : undefined,
          },
        ],
      };
    }
    if (raw.text) {
      return {
        timestamp: Date.now(),
        items: [
          {
            type: "text",
            text: String(raw.text),
            title: raw.title ? String(raw.title) : undefined,
          },
        ],
      };
    }
  }

  return null;
}

/**
 * Map a staged share-extension manifest into the normalized `SharedBatch`
 * contract. This mirrors the Rust mapping in
 * `src-tauri/plugins/plethora-folder-import/src/staged_shares.rs` — keep both
 * in sync with the schema documented in `src/types/share.ts`.
 */
export function stagedManifestToBatch(
  manifest: StagedShareManifest
): SharedBatch | null {
  if (!manifest || !Array.isArray(manifest.items) || manifest.items.length === 0) {
    return null;
  }
  const items: SharedItem[] = [];
  for (const item of manifest.items) {
    if (!item || typeof item !== "object") continue;
    switch (item.kind) {
      case "url":
        if (typeof item.urlString === "string" && item.urlString.length > 0) {
          items.push({
            type: "url",
            url: item.urlString,
            title: item.title ?? undefined,
          });
        }
        break;
      case "text":
        if (typeof item.text === "string" && item.text.length > 0) {
          items.push({
            type: "text",
            text: item.text,
            title: item.title ?? undefined,
          });
        }
        break;
      case "file":
        if (typeof item.filename === "string" && item.filename.length > 0) {
          // The Rust reader rewrites `filePath` to the app-staged copy before
          // handing the batch over; here it is filled in when available.
          items.push({
            type: "file",
            fileName: item.filename,
            mimeType: item.mimeType ?? undefined,
            filePath: undefined,
          });
        }
        break;
    }
  }
  if (items.length === 0) return null;
  return {
    id: manifest.id,
    timestamp:
      typeof manifest.receivedAt === "number" ? manifest.receivedAt : Date.now(),
    items,
  };
}

/**
 * Map staged-manifest provenance into additive `DocumentMetadata` fields:
 * `url` / `siteName` / `fetchedAt` plus the structured `shareProvenance`
 * capture-provenance record. Purely additive — existing metadata is merged,
 * never replaced, by callers.
 */
export function mapManifestToProvenance(
  manifest: Pick<StagedShareManifest, "id" | "receivedAt" | "sourceApp" | "items">,
  platform: "share_extension" | "android_share" = "share_extension"
): Partial<DocumentMetadata> {
  const urlItem = manifest.items.find((i) => i?.kind === "url");
  const url = urlItem && urlItem.kind === "url" ? urlItem.urlString : undefined;
  let siteName: string | undefined;
  if (url) {
    try {
      siteName = new URL(url).hostname.replace(/^www\./, "") || undefined;
    } catch {
      siteName = undefined;
    }
  }
  return {
    ...(url ? { url } : {}),
    ...(siteName ? { siteName } : {}),
    fetchedAt: new Date(manifest.receivedAt).toISOString(),
    shareProvenance: {
      source: platform,
      sourceApp: manifest.sourceApp,
      receivedAt: manifest.receivedAt,
      batchId: manifest.id,
      schemaVersion: 1,
    },
  };
}

/**
 * Fetch and drain any pending cold-start share batches from the native side.
 *
 * This is the cold-start counterpart to {@link registerShareListener}'s
 * return-and-clear behavior: on Android the native plugin queues batches that
 * arrive before the WebView is ready and `get_pending_shares` drains them
 * (return-and-clear, so no batch is ever delivered twice across the two
 * paths); on iOS it claims staged App Group manifests with exactly-once
 * semantics (see the folder-import plugin's staged-share reader).
 */
export async function fetchPendingShares(): Promise<SharedBatch[]> {
  if (!isTauri()) return [];
  try {
    const batches = await invokeCommand<SharedBatch[]>(
      "plugin:plethora-folder-import|get_pending_shares"
    );
    if (!Array.isArray(batches)) return [];
    const normalized: SharedBatch[] = [];
    for (const rawBatch of batches) {
      const batch = normalizeSharedBatch(rawBatch);
      if (batch) {
        normalized.push(batch);
      }
    }
    return normalized;
  } catch (err) {
    console.warn("[Share Target] Failed to fetch pending shares:", err);
    return [];
  }
}

/**
 * Acknowledge successful handoff of claimed staged batches: the Rust reader
 * deletes the `.claiming/` directories (exactly-once completion). No-op on
 * platforms without staged shares.
 */
export async function completePendingShares(ids: string[]): Promise<void> {
  if (!isTauri() || ids.length === 0) return;
  try {
    await invokeCommand(
      "plugin:plethora-folder-import|complete_pending_shares",
      { ids }
    );
  } catch (err) {
    console.warn("[Share Target] Failed to complete pending shares:", err);
  }
}

/**
 * Release claimed staged batches for another attempt (e.g. offline URL fetch
 * failed). The Rust reader enforces the attempt bound; batches exceeding it
 * move to `.failed/` and stop being served. No-op on platforms without
 * staged shares.
 */
export async function retryPendingShares(ids: string[]): Promise<void> {
  if (!isTauri() || ids.length === 0) return;
  try {
    await invokeCommand("plugin:plethora-folder-import|retry_pending_shares", {
      ids,
    });
  } catch (err) {
    console.warn("[Share Target] Failed to retry pending shares:", err);
  }
}

/**
 * Register native and web share intent listeners and retrieve any pending cold-start shares.
 */
export function registerShareListener(
  onBatch: (batch: SharedBatch) => void
): () => void {
  const handleNativeShare = (event: CustomEvent) => {
    const batch = normalizeSharedBatch(event.detail);
    if (batch) {
      onBatch(batch);
    }
  };

  const handleLegacyShareUrl = (event: CustomEvent) => {
    const rawUrl = event.detail;
    if (typeof rawUrl === "string" && rawUrl.length > 0) {
      const batch = normalizeSharedBatch(rawUrl);
      if (batch) {
        onBatch(batch);
      }
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener(
      "plethora-native-share",
      handleNativeShare as EventListener
    );
    window.addEventListener(
      "android-shared-url",
      handleLegacyShareUrl as EventListener
    );
  }

  if (isTauri()) {
    invokeCommand<ShareTargetResult>(
      "plugin:plethora-folder-import|register_share_listener"
    )
      .then((res) => {
        if (res?.batches && Array.isArray(res.batches)) {
          for (const rawBatch of res.batches) {
            const batch = normalizeSharedBatch(rawBatch);
            if (batch) {
              onBatch(batch);
            }
          }
        } else if (res?.url) {
          const batch = normalizeSharedBatch(res.url);
          if (batch) {
            onBatch(batch);
          }
        }
      })
      .catch((err) => {
        console.warn("[Share Target] Failed to register share listener:", err);
      });
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener(
        "plethora-native-share",
        handleNativeShare as EventListener
      );
      window.removeEventListener(
        "android-shared-url",
        handleLegacyShareUrl as EventListener
      );
    }
  };
}
