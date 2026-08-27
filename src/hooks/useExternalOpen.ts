/**
 * Desktop external-open listener: single-instance argv, startup files, macOS Open.
 */

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri, invokeCommand } from "../lib/tauri";
import { externalOpenToSharedBatch } from "../lib/externalOpen";
import { processSharedBatch } from "../lib/importRouting";
import type { ExternalOpenPayload } from "../types/externalOpen";
import { useDocumentStore } from "../stores/documentStore";
import { useTabsStore } from "../stores/tabsStore";
import { useToast } from "../components/common/Toast";
import { useI18n } from "../lib/i18n";

export function useExternalOpen() {
  const toast = useToast();
  const { t } = useI18n();
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;

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

    const handlePayload = async (payload: ExternalOpenPayload) => {
      const batch = externalOpenToSharedBatch(payload);
      if (!batch) return;
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      try {
        await processSharedBatch(batch, deps);
      } finally {
        isProcessingRef.current = false;
      }
    };

    let unlisten: (() => void) | undefined;
    void listen<ExternalOpenPayload>("external-open", (event) => {
      void handlePayload(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    void invokeCommand<ExternalOpenPayload[]>("take_pending_external_opens")
      .then((pending) => {
        if (!Array.isArray(pending)) return;
        for (const payload of pending) {
          void handlePayload(payload);
        }
      })
      .catch((err) => {
        console.warn("[ExternalOpen] failed to drain pending opens:", err);
      });

    return () => {
      unlisten?.();
    };
  }, [t, toast]);
}
