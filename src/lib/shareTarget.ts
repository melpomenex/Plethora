/**
 * Native Mobile and Web Share Target integration.
 *
 * Normalizes incoming share intents from Android / iOS and PWA web share targets
 * into structured SharedBatch payloads.
 */

import { invokeCommand, isTauri } from "./tauri";
import type { SharedBatch, SharedItem, ShareTargetResult } from "../types/share";

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
      "incrementum-native-share",
      handleNativeShare as EventListener
    );
    window.addEventListener(
      "android-shared-url",
      handleLegacyShareUrl as EventListener
    );
  }

  if (isTauri()) {
    invokeCommand<ShareTargetResult>(
      "plugin:incrementum-folder-import|register_share_listener"
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
        "incrementum-native-share",
        handleNativeShare as EventListener
      );
      window.removeEventListener(
        "android-shared-url",
        handleLegacyShareUrl as EventListener
      );
    }
  };
}
