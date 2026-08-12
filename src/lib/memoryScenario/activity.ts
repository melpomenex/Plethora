/**
 * App-side activity counter for the memory benchmark harness.
 *
 * The harness (scripts/memory-bench/) launches the app with
 * INCREMENTUM_MEMORY_SCENARIO=1 and INCREMENTUM_MEMORY_CONTROL=<url>. The
 * scenario host (host.ts) enables the counter by setting
 * `window.__memoryScenarioEnabled = true` BEFORE any step runs.
 *
 * Production builds never set that flag, so every `markBusy` call below is a
 * no-op — the scenario surface is inert without the harness environment
 * (design D2, task 3.3). The flag is deliberately a window property rather
 * than a module constant: the same bundled code has to be inert in production
 * and active under the harness without a rebuild.
 */

declare global {
  interface Window {
    /** Set by the memory-scenario host when the harness env is present. */
    __memoryScenarioEnabled?: boolean;
  }
}

let busyCount = 0;

/** Mark an in-flight document load / render / persistence task. No-op when the scenario is disabled. */
export function markBusy(busy: boolean): void {
  if (!window.__memoryScenarioEnabled) return;
  busyCount = Math.max(0, busyCount + (busy ? 1 : -1));
}

/** Whether any in-flight task is currently reported. False when the scenario is disabled. */
export function isBusy(): boolean {
  return window.__memoryScenarioEnabled === true && busyCount > 0;
}

/** Reset the counter (used by the host between stages and by tests). */
export function resetBusy(): void {
  busyCount = 0;
}
