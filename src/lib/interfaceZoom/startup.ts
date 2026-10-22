/**
 * Interface-zoom startup bootstrap (change: desktop-global-interface-zoom).
 *
 * Runs before the React application graph is imported so the first interactive
 * frame uses the persisted native scale instead of painting at 100% and
 * jumping. Deliberately dependency-light: raw persisted storage, the pure
 * constants, and the native layer only. It never imports the Settings store,
 * React, or any component, and it never writes storage — the controller owns
 * rollback after React mounts.
 */

import { migratedGetItem } from "../brandMigration";
import {
  INTERFACE_ZOOM_DEFAULT,
  normalizeInterfaceZoom,
} from "./constants";
import { applyNativeInterfaceZoom, isDesktopInterfaceZoomSupported } from "./native";

const STARTUP_APPLY_TIMEOUT_MS = 1_200;
const STARTUP_RESET_TIMEOUT_MS = 300;

export type BootstrapResult = {
  supported: boolean;
  appliedPercent: number;
  error: string | null;
};

let bootstrapPromise: Promise<BootstrapResult> | null = null;
let bootstrapResult: BootstrapResult | null = null;

function unsupportedResult(): BootstrapResult {
  return { supported: false, appliedPercent: INTERFACE_ZOOM_DEFAULT, error: null };
}

function defaultResult(): BootstrapResult {
  return {
    supported: isDesktopInterfaceZoomSupported(),
    appliedPercent: INTERFACE_ZOOM_DEFAULT,
    error: null,
  };
}

function isScreenshotOverlayRoute(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.location.hash.startsWith("#/screenshot-overlay")
    );
  } catch {
    return false;
  }
}

/** Read the persisted percentage without trusting the storage shape. */
function readPersistedPercent(): number {
  try {
    const raw = migratedGetItem("plethora-settings");
    if (!raw) return INTERFACE_ZOOM_DEFAULT;
    const parsed = JSON.parse(raw) as {
      state?: { settings?: { interface?: { interfaceZoom?: unknown } } };
      settings?: { interface?: { interfaceZoom?: unknown } };
      interface?: { interfaceZoom?: unknown };
    };
    const candidate =
      parsed.state?.settings?.interface?.interfaceZoom ??
      parsed.settings?.interface?.interfaceZoom ??
      parsed.interface?.interfaceZoom;
    return normalizeInterfaceZoom(candidate);
  } catch {
    return INTERFACE_ZOOM_DEFAULT;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms} ms (${label})`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function runBootstrap(): Promise<BootstrapResult> {
  // The screenshot utility route must never be zoomed.
  if (isScreenshotOverlayRoute()) return unsupportedResult();
  if (!isDesktopInterfaceZoomSupported()) return unsupportedResult();

  const target = readPersistedPercent();
  try {
    // Apply even 100%: a WebView reload must not inherit a stale native zoom.
    await withTimeout(
      applyNativeInterfaceZoom(target),
      STARTUP_APPLY_TIMEOUT_MS,
      `startup apply ${target}%`,
    );
    return { supported: true, appliedPercent: target, error: null };
  } catch (error) {
    const message = describeError(error);
    console.warn(`[interfaceZoom] startup apply failed for ${target}%: ${message}`);
    try {
      await withTimeout(
        applyNativeInterfaceZoom(INTERFACE_ZOOM_DEFAULT),
        STARTUP_RESET_TIMEOUT_MS,
        "startup reset 100%",
      );
    } catch {
      /* best effort */
    }
    return {
      supported: true,
      appliedPercent: INTERFACE_ZOOM_DEFAULT,
      error: message,
    };
  }
}

/**
 * Memoized one-shot startup apply. The promise is shared by `main-bootstrap`
 * and the React bridge so the native API is called at most once here.
 */
export function bootstrapInterfaceZoom(): Promise<BootstrapResult> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().then((result) => {
      bootstrapResult = result;
      return result;
    });
  }
  return bootstrapPromise;
}

export function getBootstrapResult(): BootstrapResult | null {
  return bootstrapResult;
}

/**
 * Resolve the startup result without starting a native call. If the bootstrap
 * was never started (for example a Settings-only test), this resolves to the
 * platform default so the controller can reconcile deterministically.
 */
export function getBootstrapPromise(): Promise<BootstrapResult> {
  return bootstrapPromise ?? Promise.resolve(defaultResult());
}
