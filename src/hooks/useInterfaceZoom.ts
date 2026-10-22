/**
 * React bridge for the interface-zoom controller (change:
 * desktop-global-interface-zoom).
 *
 * `useInterfaceZoomBridge` is mounted once by the application shell before
 * other global shortcuts so its capture listener is registered first.
 * `useInterfaceZoomState` is the read-only state feed for the Settings control.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useToast } from "../components/common/Toast";
import { useI18n } from "../lib/i18n";
import {
  getInterfaceZoomStatus,
  startInterfaceZoomSync,
  subscribeInterfaceZoomStatus,
} from "../lib/interfaceZoom/controller";
import {
  INTERFACE_ZOOM_DEFAULT,
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  normalizeInterfaceZoom,
} from "../lib/interfaceZoom/constants";
import { handleInterfaceZoomKeyDown } from "../lib/interfaceZoom/shortcuts";

/**
 * Start the controller, own the single capture-phase keydown listener, and
 * surface one toast per native failure. Mount once in `MainLayout`.
 */
export function useInterfaceZoomBridge(): void {
  const { t } = useI18n();
  const toast = useToast();
  const status = useSyncExternalStore(
    subscribeInterfaceZoomStatus,
    getInterfaceZoomStatus,
    getInterfaceZoomStatus,
  );
  const lastErrorNonceRef = useRef(0);

  // Reconcile the startup result before paint where possible.
  useLayoutEffect(() => {
    startInterfaceZoomSync();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleInterfaceZoomKeyDown(event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (status.errorNonce <= 0) return;
    if (status.errorNonce === lastErrorNonceRef.current) return;
    lastErrorNonceRef.current = status.errorNonce;
    toast.error(t("settings.interfaceZoomError"));
  }, [status.errorNonce, t, toast]);
}

export type InterfaceZoomState = {
  percent: number;
  supported: boolean;
  applying: boolean;
  appliedPercent: number;
  error: string | null;
  errorNonce: number;
  canIncrease: boolean;
  canDecrease: boolean;
  canReset: boolean;
};

/**
 * Read-only zoom state. The returned object is memoized on primitive values so
 * consumers cannot trigger render loops from a new reference each pass.
 */
export function useInterfaceZoomState(): InterfaceZoomState {
  const percent = useSettingsStore((state) =>
    normalizeInterfaceZoom(state.settings.interface.interfaceZoom),
  );
  const status = useSyncExternalStore(
    subscribeInterfaceZoomStatus,
    getInterfaceZoomStatus,
    getInterfaceZoomStatus,
  );

  return useMemo(
    () => ({
      percent,
      supported: status.supported,
      applying: status.applying,
      appliedPercent: status.appliedPercent,
      error: status.error,
      errorNonce: status.errorNonce,
      canIncrease: status.supported && percent < INTERFACE_ZOOM_MAX,
      canDecrease: status.supported && percent > INTERFACE_ZOOM_MIN,
      canReset: status.supported && percent !== INTERFACE_ZOOM_DEFAULT,
    }),
    [
      percent,
      status.supported,
      status.applying,
      status.appliedPercent,
      status.error,
      status.errorNonce,
    ],
  );
}
