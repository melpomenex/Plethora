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
import { processSharedBatch } from "../lib/importRouting";
import { useDocumentStore } from "../stores/documentStore";
import { useTabsStore } from "../stores/tabsStore";
import { useToast } from "../components/common/Toast";
import { useI18n } from "../lib/i18n";
import type { SharedBatch, SharedItem } from "../types/share";

export function useShareTarget() {
  const toast = useToast();
  const { t } = useI18n();
  const isProcessingRef = useRef(false);

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

    const handleBatch = async (batch: SharedBatch) => {
      if (!batch.items || batch.items.length === 0) return { imported: 0, failed: 0 };
      if (isProcessingRef.current) return { imported: 0, failed: 0 };
      isProcessingRef.current = true;
      try {
        return await processSharedBatch(batch, deps);
      } finally {
        isProcessingRef.current = false;
      }
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
    };
  }, [t, toast]);
}
