/**
 * Interface-zoom controller (change: desktop-global-interface-zoom).
 *
 * Single owner of the zoom queue, status, startup reconciliation, and failure
 * rollback. The persisted preference (`settings.interface.interfaceZoom`) is
 * the desired value; this module serializes native applications, coalesces
 * rapid requests to the latest value, and never persists its own status.
 */

import {
  INTERFACE_ZOOM_DEFAULT,
  normalizeInterfaceZoom,
  stepInterfaceZoom,
} from "./constants";
import { applyNativeInterfaceZoom, isDesktopInterfaceZoomSupported } from "./native";
import { getBootstrapPromise, type BootstrapResult } from "./startup";
import { useSettingsStore } from "../../stores/settingsStore";

/** Bound on a single interactive native apply. */
const APPLY_TIMEOUT_MS = 5_000;
/** Short bound on the best-effort rollback apply. */
const BEST_EFFORT_RESET_TIMEOUT_MS = 300;
/** Bound on waiting for startup's native result before enabling the bridge. */
const BOOTSTRAP_WAIT_TIMEOUT_MS = 2_500;

export type InterfaceZoomStatus = {
  supported: boolean;
  applying: boolean;
  appliedPercent: number;
  error: string | null;
  errorNonce: number;
};

let status: InterfaceZoomStatus = {
  supported: isDesktopInterfaceZoomSupported(),
  applying: false,
  appliedPercent: INTERFACE_ZOOM_DEFAULT,
  error: null,
  errorNonce: 0,
};

const statusListeners = new Set<() => void>();

let lastApplied = INTERFACE_ZOOM_DEFAULT;
let latestRequested = INTERFACE_ZOOM_DEFAULT;
let applying = false;
let requestSeq = 0;
let errorNonce = 0;
let started = false;
let unsubscribeStore: (() => void) | null = null;
let lateBootstrapReconciled = false;

function setStatus(patch: Partial<InterfaceZoomStatus>): void {
  status = { ...status, ...patch };
  for (const listener of statusListeners) listener();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("timed out after");
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

function readStorePercent(): number {
  return normalizeInterfaceZoom(
    useSettingsStore.getState().settings.interface.interfaceZoom,
  );
}

function notifyViewportChanged(): void {
  if (typeof window === "undefined") return;
  const dispatch = () => window.dispatchEvent(new Event("resize"));
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(dispatch);
  } else {
    window.setTimeout(dispatch, 0);
  }
}

export function getInterfaceZoomStatus(): InterfaceZoomStatus {
  return status;
}

export function subscribeInterfaceZoomStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function schedule(target: number): void {
  latestRequested = normalizeInterfaceZoom(target);
  if (applying) return;
  if (latestRequested === lastApplied) return;
  applying = true;
  void drain();
}

async function drain(): Promise<void> {
  try {
    while (latestRequested !== lastApplied) {
      const seq = ++requestSeq;
      const target = latestRequested;
      setStatus({ applying: true, error: null });

      try {
        await withTimeout(
          applyNativeInterfaceZoom(target),
          APPLY_TIMEOUT_MS,
          `apply ${target}%`,
        );
        lastApplied = target;
        setStatus({ applying: false, appliedPercent: target, error: null });
        notifyViewportChanged();
      } catch (error) {
        // A newer request is already pending: its result owns the final state,
        // so a stale failure must not roll anything back.
        if (seq !== requestSeq || target !== latestRequested) continue;

        const fallback = lastApplied;
        const message = describeError(error);
        console.warn(`[interfaceZoom] failed to apply ${target}%: ${message}`);

        // One best-effort reset so a partially applied native state is less
        // likely to survive the rollback. A second failure is not reported.
        try {
          await withTimeout(
            applyNativeInterfaceZoom(fallback),
            BEST_EFFORT_RESET_TIMEOUT_MS,
            `rollback ${fallback}%`,
          );
        } catch {
          /* best effort */
        }

        // The reset awaited IPC; a newer request may have arrived meanwhile.
        if (seq !== requestSeq || target !== latestRequested) continue;

        latestRequested = fallback;
        errorNonce += 1;
        setStatus({
          applying: false,
          appliedPercent: fallback,
          error: message,
          errorNonce,
        });
        useSettingsStore
          .getState()
          .updateSettingsCategory("interface", { interfaceZoom: fallback });
        return;
      }
    }
  } finally {
    applying = false;
    if (latestRequested !== lastApplied) schedule(latestRequested);
  }
}

function subscribeToStore(): void {
  if (unsubscribeStore) return;
  unsubscribeStore = useSettingsStore.subscribe((next, previous) => {
    const requested = normalizeInterfaceZoom(
      next.settings.interface.interfaceZoom,
    );
    const before = normalizeInterfaceZoom(
      previous.settings.interface.interfaceZoom,
    );
    if (requested === before) return;
    schedule(requested);
  });
}

function reconcileBootstrap(result: BootstrapResult, allowStoreRollback: boolean): void {
  lastApplied = normalizeInterfaceZoom(result.appliedPercent);
  latestRequested = lastApplied;
  if (result.error) {
    errorNonce += 1;
    console.warn(`[interfaceZoom] startup apply failed: ${result.error}`);
    setStatus({
      supported: true,
      applying: false,
      appliedPercent: lastApplied,
      error: result.error,
      errorNonce,
    });
    if (allowStoreRollback) {
      useSettingsStore
        .getState()
        .updateSettingsCategory("interface", { interfaceZoom: lastApplied });
    }
    return;
  }
  setStatus({
    supported: true,
    applying: false,
    appliedPercent: lastApplied,
    error: null,
  });
}

/**
 * Late reconciliation if the 2500 ms bridge fallback won the race with a
 * wedged startup promise. Never clobbers a newer user request.
 */
function reconcileLateBootstrap(result: BootstrapResult): void {
  if (lateBootstrapReconciled) return;
  lateBootstrapReconciled = true;
  if (applying || latestRequested !== lastApplied) return;

  lastApplied = normalizeInterfaceZoom(result.appliedPercent);
  latestRequested = lastApplied;
  if (result.error) {
    errorNonce += 1;
    console.warn(`[interfaceZoom] startup apply failed: ${result.error}`);
    setStatus({
      supported: true,
      applying: false,
      appliedPercent: lastApplied,
      error: result.error,
      errorNonce,
    });
    useSettingsStore
      .getState()
      .updateSettingsCategory("interface", { interfaceZoom: lastApplied });
    return;
  }
  setStatus({
    supported: true,
    applying: false,
    appliedPercent: lastApplied,
    error: null,
  });
  const storeValue = readStorePercent();
  if (storeValue !== lastApplied) schedule(storeValue);
}

async function beginSync(): Promise<void> {
  if (!isDesktopInterfaceZoomSupported()) {
    setStatus({
      supported: false,
      applying: false,
      appliedPercent: INTERFACE_ZOOM_DEFAULT,
      error: null,
    });
    return;
  }

  const bootstrapPromise = getBootstrapPromise();
  let result: BootstrapResult | null = null;
  let timedOut = false;

  try {
    result = await withTimeout(
      bootstrapPromise,
      BOOTSTRAP_WAIT_TIMEOUT_MS,
      "startup bootstrap",
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      timedOut = true;
      void bootstrapPromise.then(reconcileLateBootstrap).catch(() => {
        /* a rejected late promise was already reported by startup */
      });
    } else {
      // A rejected startup promise is a startup failure: fall back to 100.
      result = {
        supported: true,
        appliedPercent: INTERFACE_ZOOM_DEFAULT,
        error: describeError(error),
      };
    }
  }

  if (timedOut) {
    lastApplied = INTERFACE_ZOOM_DEFAULT;
    latestRequested = INTERFACE_ZOOM_DEFAULT;
    setStatus({
      supported: true,
      applying: false,
      appliedPercent: INTERFACE_ZOOM_DEFAULT,
      error: null,
    });
  } else if (result && !result.supported) {
    // Utility routes (for example the screenshot overlay) must stay inert.
    setStatus({
      supported: false,
      applying: false,
      appliedPercent: INTERFACE_ZOOM_DEFAULT,
      error: null,
    });
    return;
  } else if (result) {
    reconcileBootstrap(result, true);
  }

  subscribeToStore();

  // Reconcile any difference between the raw startup parse and the hydrated
  // store exactly once. When startup already applied the same value this is a
  // no-op, so no duplicate native call is issued.
  const storeValue = readStorePercent();
  if (!status.error && storeValue !== lastApplied) schedule(storeValue);
}

/** Idempotent: consumes the startup result, then subscribes to the store once. */
export function startInterfaceZoomSync(): void {
  if (started) return;
  started = true;
  void beginSync();
}

function applyUserZoom(target: number): void {
  if (!isDesktopInterfaceZoomSupported() || !status.supported) return;
  startInterfaceZoomSync();
  const next = normalizeInterfaceZoom(target);
  if (next === readStorePercent()) return;
  useSettingsStore
    .getState()
    .updateSettingsCategory("interface", { interfaceZoom: next });
}

export function zoomInterfaceIn(): void {
  applyUserZoom(stepInterfaceZoom(readStorePercent(), "in"));
}

export function zoomInterfaceOut(): void {
  applyUserZoom(stepInterfaceZoom(readStorePercent(), "out"));
}

export function resetInterfaceZoom(): void {
  applyUserZoom(INTERFACE_ZOOM_DEFAULT);
}

export function setInterfaceZoomPercent(percent: number): void {
  applyUserZoom(normalizeInterfaceZoom(percent));
}

/** Test-only: clear module state without touching persisted settings. */
export function __resetInterfaceZoomForTests(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  started = false;
  applying = false;
  requestSeq = 0;
  errorNonce = 0;
  lateBootstrapReconciled = false;
  lastApplied = INTERFACE_ZOOM_DEFAULT;
  latestRequested = INTERFACE_ZOOM_DEFAULT;
  status = {
    supported: isDesktopInterfaceZoomSupported(),
    applying: false,
    appliedPercent: INTERFACE_ZOOM_DEFAULT,
    error: null,
    errorNonce: 0,
  };
  for (const listener of statusListeners) listener();
}
