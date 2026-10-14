/**
 * Hook for consuming native Android/iOS and Web Share Target intents.
 *
 * Listens for incoming shared batches, routes URLs and staged files to
 * useDocumentStore, and creates notifications with immediate "Open" action.
 */

import { useEffect, useRef } from "react";
import {
  completePendingShares,
  fetchPendingShares,
  registerShareListener,
  retryPendingShares,
} from "../lib/shareTarget";
import { processSharedBatch, type ProcessSharedBatchResult } from "../lib/importRouting";
import { extractXStatusId } from "../lib/xthreadUrl";
import { useDocumentStore } from "../stores/documentStore";
import { useTabsStore } from "../stores/tabsStore";
import { useToast } from "../components/common/Toast";
import { useI18n } from "../lib/i18n";
import { isNativeMobile, nativePlatform } from "../lib/tauri";
import type { SharedBatch, SharedItem } from "../types/share";

function getItemDedupeKey(item: SharedItem): string {
  if (item.type === "url" && item.url) {
    const statusId = extractXStatusId(item.url);
    if (statusId) {
      return `x-status-${statusId}`;
    }
    try {
      const parsed = new URL(item.url);
      const searchParams = new URLSearchParams(parsed.search);
      for (const param of Array.from(searchParams.keys())) {
        if (/^(utm_|ref|fbclid|gclid)/i.test(param)) {
          searchParams.delete(param);
        }
      }
      parsed.search = searchParams.toString();
      parsed.hash = "";
      return `url-${parsed.toString().replace(/\/$/, "")}`;
    } catch {
      return `url-${item.url.trim().replace(/\/$/, "")}`;
    }
  }
  if (item.type === "file" && item.filePath) {
    return `file-${item.filePath}`;
  }
  if (item.type === "text" && item.text) {
    return `text-${item.text.trim()}`;
  }
  return `item-${Math.random()}`;
}

function getBatchDedupeKey(batch: SharedBatch): string {
  if (!batch.items || batch.items.length === 0) return "";
  return batch.items.map(getItemDedupeKey).sort().join("|");
}

export function useShareTarget() {
  const toast = useToast();
  const { t } = useI18n();
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const inFlightBatchesRef = useRef<Map<string, Promise<ProcessSharedBatchResult>>>(new Map());
  const recentBatchesRef = useRef<Map<string, ProcessSharedBatchResult>>(new Map());
  const recentTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const deps = {
      t,
      toast,
      getDocumentStore: () => useDocumentStore.getState(),
      getTabsStore: () => useTabsStore.getState(),
      openExternal: async (url: string) => {
        const { openExternal } = await import("../lib/tauri");
        await openExternal(url);
      },
    };

    const handleBatch = (batch: SharedBatch): Promise<ProcessSharedBatchResult> => {
      if (!batch.items || batch.items.length === 0) {
        return Promise.resolve({ imported: 0, failed: 0 });
      }

      const batchKey = getBatchDedupeKey(batch);
      if (batchKey) {
        const inFlight = inFlightBatchesRef.current.get(batchKey);
        if (inFlight) {
          return inFlight;
        }

        const recent = recentBatchesRef.current.get(batchKey);
        if (recent) {
          return Promise.resolve(recent);
        }
      }

      let resolvePromise!: (result: ProcessSharedBatchResult) => void;
      let rejectPromise!: (err: unknown) => void;
      const batchPromise = new Promise<ProcessSharedBatchResult>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });

      if (batchKey) {
        inFlightBatchesRef.current.set(batchKey, batchPromise);
      }

      const execute = async (): Promise<ProcessSharedBatchResult> => {
        try {
          const platform = nativePlatform()?.toLowerCase();
          const shareIngress = isNativeMobile()
            ? {
                origin: platform === "ios" ? "share_extension" as const : "android_share" as const,
                sourceApp: batch.sourceApp,
              }
            : undefined;
          const result = await processSharedBatch(batch, deps, shareIngress);
          if (batchKey && result.failed === 0) {
            recentBatchesRef.current.set(batchKey, result);
            const timer = setTimeout(() => {
              recentBatchesRef.current.delete(batchKey);
              recentTimersRef.current.delete(batchKey);
            }, 2500);
            recentTimersRef.current.set(batchKey, timer);
          }
          resolvePromise(result);
          return result;
        } catch (err) {
          rejectPromise(err);
          throw err;
        } finally {
          if (batchKey) {
            inFlightBatchesRef.current.delete(batchKey);
          }
        }
      };

      queueRef.current = queueRef.current.then(execute, execute);
      return batchPromise;
    };

    // Check PWA query parameter in hash route: #/?shared_url=... or #/?shared_text=...
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash.includes("?shared_url=") || hash.includes("?shared_text=")) {
        try {
          const hashParams = new URLSearchParams(hash.split("?")[1]);
          const sharedUrl = hashParams.get("shared_url");
          const sharedText = hashParams.get("shared_text");
          const sharedTitle = hashParams.get("title");

          const items: SharedItem[] = [];
          if (sharedUrl) {
            items.push({ type: "url", url: sharedUrl, title: sharedTitle || undefined });
          }
          if (sharedText) {
            items.push({ type: "text", text: sharedText, title: sharedTitle || undefined });
          }

          if (items.length > 0) {
            const cleanHash = hash.split("?")[0];
            window.location.hash = cleanHash;
            void handleBatch({ timestamp: Date.now(), items });
          }
        } catch (e) {
          console.error("[Share Target] Failed to parse hash query params:", e);
        }
      }
    }

    const unsubscribe = registerShareListener(handleBatch);

    void fetchPendingShares().then(async (batches) => {
      for (const batch of batches) {
        const result = await handleBatch(batch);
        if (!batch.id) continue;
        if (result.failed === 0) {
          void completePendingShares([batch.id]);
        } else {
          void retryPendingShares([batch.id]);
          toast.warning(
            t("shareTarget.pendingSharesTitle"),
            t("shareTarget.pendingSharesMessage"),
            { duration: 8000 },
          );
        }
      }
    });

    return () => {
      unsubscribe();
      recentTimersRef.current.forEach((timer) => clearTimeout(timer));
      recentTimersRef.current.clear();
      inFlightBatchesRef.current.clear();
      recentBatchesRef.current.clear();
    };
  }, [t, toast]);
}
