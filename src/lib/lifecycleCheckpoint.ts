/**
 * Mobile/desktop lifecycle checkpoint: flush session on suspend.
 */

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./tauri";
import type { AppLifecyclePayload } from "../types/externalOpen";
import { useTabsStore } from "../stores/tabsStore";
import { useSettingsStore } from "../stores/settingsStore";

let suspendFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushSessionCheckpoint() {
  const restoreSession =
    useSettingsStore.getState().settings.general.restoreSession;
  if (!restoreSession) return;
  try {
    useTabsStore.getState().saveTabs();
    console.info("[TauriLifecycle] session checkpoint flushed");
  } catch (err) {
    console.warn("[TauriLifecycle] session checkpoint flush failed", err);
  }
}

export function useLifecycleCheckpoint() {
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    void listen<AppLifecyclePayload>("app-lifecycle", (event) => {
      if (event.payload.phase === "suspended") {
        if (suspendFlushTimer) clearTimeout(suspendFlushTimer);
        suspendFlushTimer = setTimeout(() => {
          suspendFlushTimer = null;
          flushSessionCheckpoint();
        }, 250);
      } else if (event.payload.phase === "resumed") {
        console.info("[TauriLifecycle] resumed");
      }
    }).then((fn) => {
      unlisten = fn;
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushSessionCheckpoint();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unlisten?.();
      document.removeEventListener("visibilitychange", onVisibility);
      if (suspendFlushTimer) clearTimeout(suspendFlushTimer);
    };
  }, []);
}
