/**
 * WebView content-process termination recovery (macOS/iOS).
 *
 * Relies on the Rust shell to emit `webview-content-process-terminated` and on
 * Tauri's rate-limited reload. After reload, the frontend re-reads the persisted
 * tabs session when `restoreSession` is enabled.
 */

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./tauri";
import type { WebviewRecoveryPayload } from "../types/externalOpen";
import { useSettingsStore } from "../stores/settingsStore";
import { useTabsStore } from "../stores/tabsStore";

const WINDOW_MS = 30_000;
const MAX_RECOVERIES = 3;
const recoveryTimestamps: number[] = [];

function recordRecovery(): number {
  const now = Date.now();
  while (recoveryTimestamps.length > 0 && now - recoveryTimestamps[0] > WINDOW_MS) {
    recoveryTimestamps.shift();
  }
  recoveryTimestamps.push(now);
  return recoveryTimestamps.length;
}

export function shouldEnterSafeRecoveryMode(): boolean {
  const now = Date.now();
  const recent = recoveryTimestamps.filter((t) => now - t <= WINDOW_MS);
  return recent.length >= MAX_RECOVERIES;
}

export function useWebviewRecovery(onSafeMode?: () => void) {
  const onSafeModeRef = useRef(onSafeMode);
  onSafeModeRef.current = onSafeMode;

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    void listen<WebviewRecoveryPayload>(
      "webview-content-process-terminated",
      (event) => {
        const count = recordRecovery();
        console.warn(
          `[WebviewRecovery] content process terminated (${event.payload.label}); recovery #${count}`,
        );
        if (shouldEnterSafeRecoveryMode()) {
          console.error("[WebviewRecovery] entering safe recovery mode");
          onSafeModeRef.current?.();
          return;
        }
        const restoreSession =
          useSettingsStore.getState().settings.general.restoreSession;
        if (restoreSession) {
          // Session snapshot is persisted by tabsStore; reload will rehydrate.
          void useTabsStore.getState().loadTabs();
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
