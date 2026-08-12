/**
 * App-side quiescence signal (task 3.2).
 *
 * A stage may only be sampled once the app has no in-flight document load,
 * render, or position-persistence task. The signal is a combination of:
 *   - the scenario activity counter (markBusy), which the viewers bump around
 *     document loads and position saves — runtime-gated, inert in production;
 *   - the document store's loading/importing flags;
 *   - whether tabsStore still has a debounced persistence save pending.
 *
 * The driver independently confirms memory-level settle (three stable tree-Pss
 * reads); this signal is the app's own, faster view.
 */

import { markBusy, isBusy, resetBusy } from "./activity";
import { useDocumentStore } from "../../stores/documentStore";
import { hasPendingTabsSave } from "../../stores/tabsStore";

export interface QuiescenceState {
  inFlightTask: boolean;
  storeLoading: boolean;
  storeImporting: boolean;
  pendingTabsSave: boolean;
  /** Elapsed ms of the stabilization delay applied on top of the signals. */
  stabilizationElapsedMs: number;
  quiescent: boolean;
}

/**
 * Wait until the app reports quiescent, or `timeoutMs` elapses.
 *
 * @param signalFn - returns true when the app is quiescent (defaults to the
 *   store-based signal; tests inject their own).
 * @returns the quiescence state at the end of the wait.
 */
export async function waitForQuiescence(
  options: {
    timeoutMs?: number;
    pollMs?: number;
    stabilizationMs?: number;
    signalFn?: () => boolean;
  } = {},
): Promise<QuiescenceState> {
  const { timeoutMs = 30_000, pollMs = 250, stabilizationMs = 500 } = options;
  const signalFn = options.signalFn ?? quiescenceSignal;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signalFn()) break;
    await sleep(pollMs);
  }

  // A short fixed stabilization delay: rendering work (canvas paints, layout)
  // is not observable through store state, so the signal is allowed a bounded
  // grace period. The driver's own stable-Pss settle is the authoritative
  // memory-level condition.
  const started = Date.now();
  await sleep(stabilizationMs);

  const state = computeQuiescence(signalFn());
  state.stabilizationElapsedMs = Date.now() - started;
  return state;
}

/** Current quiescence from store-level signals only. */
export function quiescenceSignal(): boolean {
  return !isBusy() && !storeLoading() && !storeImporting() && !pendingTabsSave();
}

export function computeQuiescence(signal: boolean): QuiescenceState {
  return {
    inFlightTask: isBusy(),
    storeLoading: storeLoading(),
    storeImporting: storeImporting(),
    pendingTabsSave: pendingTabsSave(),
    stabilizationElapsedMs: 0,
    quiescent: signal,
  };
}

/** Reset the busy counter and stabilization bookkeeping between stages. */
export function resetQuiescence(): void {
  resetBusy();
}

/** The activity module is exported for the viewer hooks. */
export { markBusy };

function storeLoading(): boolean {
  return readStoreFlag("isLoading");
}

function storeImporting(): boolean {
  return readStoreFlag("isImporting");
}

/** tabsStore pending-save getter (module-private timer exposed for the harness). */
function pendingTabsSave(): boolean {
  return hasPendingTabsSave();
}

function readStoreFlag(flag: "isLoading" | "isImporting"): boolean {
  return useDocumentStore.getState()[flag] === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
