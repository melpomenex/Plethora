import React from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getLayaServerStatus,
  startLayaServer,
  stopLayaServer,
  type LayaServerStatus,
} from "../api/layaRuntime";
import { LAYA_PROVIDER_ID } from "../lib/daqe/decisionModelOptions";
import { isNativeMobile, isTauri } from "../lib/tauri";
import { useSettingsStore } from "../stores/settingsStore";
import { useSmartFeedsStore } from "../stores/smartFeedsStore";

export interface UseLayaServerStatusResult {
  status: LayaServerStatus | null;
  busy: boolean;
  starting: boolean;
  error: string | null;
  supported: boolean;
  start: (options?: { selectProvider?: boolean }) => Promise<LayaServerStatus | null>;
  stop: () => Promise<LayaServerStatus | null>;
  refresh: () => Promise<LayaServerStatus | null>;
}

/**
 * Subscribe to the managed local Laya server status and expose start/stop actions.
 *
 * Refreshes Smart Feeds capabilities whenever the server transitions state so
 * RSS View and SmartFeedDialog immediately reflect the live local endpoint.
 */
export function useLayaServerStatus(enabled = true): UseLayaServerStatusResult {
  const supported = isTauri() && !isNativeMobile();
  const [status, setStatus] = React.useState<LayaServerStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!supported) return null;
    try {
      const next = await getLayaServerStatus();
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [supported]);

  React.useEffect(() => {
    if (!supported || !enabled) return;
    let mounted = true;
    let unlisten: (() => void) | undefined;

    void listen<LayaServerStatus>("laya://server-status", (event) => {
      if (!mounted) return;
      setStatus(event.payload);
      if (event.payload.phase === "running" || event.payload.phase === "stopped") {
        void useSmartFeedsStore.getState().loadCapabilities();
      }
    })
      .then((stopListening) => {
        if (mounted) unlisten = stopListening;
        else stopListening();
      })
      .catch(() => {});

    void getLayaServerStatus()
      .then((next) => {
        if (mounted) setStatus(next);
      })
      .catch(() => {});

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [supported, enabled]);

  const start = React.useCallback(
    async (options?: { selectProvider?: boolean }) => {
      if (!supported) return null;
      setBusy(true);
      setError(null);
      try {
        const next = await startLayaServer();
        setStatus(next);
        if (options?.selectProvider !== false) {
          const store = useSettingsStore.getState();
          const currentModel = store.settings.daqe?.decisionEngine?.model ?? "";
          store.updateSettingsCategory("daqe", {
            decisionModelProviderId: LAYA_PROVIDER_ID,
            decisionEngine: {
              baseUrl: next.endpoint,
              model: currentModel,
            },
          });
        }
        await useSmartFeedsStore.getState().loadCapabilities();
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [supported],
  );

  const stop = React.useCallback(async () => {
    if (!supported) return null;
    setBusy(true);
    setError(null);
    try {
      const next = await stopLayaServer();
      setStatus(next);
      await useSmartFeedsStore.getState().loadCapabilities();
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const starting =
    busy ||
    ["preparing-model", "installing-runtime", "starting"].includes(status?.phase ?? "");

  return {
    status,
    busy,
    starting,
    error,
    supported,
    start,
    stop,
    refresh,
  };
}
