/**
 * Diagnostics switch (change eliminate-long-running-memory-growth, design
 * D6/D9/D13).
 *
 * The resource-lifetime diagnostics surface (owned-URL registry, error
 * aggregates, resource counts) and the test heartbeat are INERT in production
 * builds unless this gate is on. Enable paths:
 *
 *   - development builds (`import.meta.env.DEV`),
 *   - the memory-scenario harness env (the scenario host flips the window
 *     flag when `get_memory_scenario_config` returns a config),
 *   - an explicit runtime opt-in (`localStorage["plethora-diagnostics"]=1`
 *     set before boot, or `window.__plethoraDiagnostics = true`).
 *
 * The webview cannot read process env vars; the Rust scenario config bridge
 * is the env path (config.ts). Nothing here monkey-patches browser globals —
 * the flag is a plain boolean the hosts set.
 */

const STORAGE_KEY = "plethora-diagnostics";

declare global {
  interface Window {
    /** Set by the scenario host / reliability harness to arm diagnostics. */
    __plethoraDiagnostics?: boolean;
    /** Set by tests to force the gate state (never set by app code). */
    __plethoraDiagnosticsTestOverride?: boolean | null;
  }
}

function readLocalStorageFlag(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** True when the diagnostics surface is armed. Cheap; safe to call per op. */
export function isDiagnosticsEnabled(): boolean {
  if (typeof window !== "undefined" && window.__plethoraDiagnosticsTestOverride !== undefined && window.__plethoraDiagnosticsTestOverride !== null) {
    return window.__plethoraDiagnosticsTestOverride;
  }
  if (typeof window !== "undefined" && window.__plethoraDiagnostics === true) return true;
  if (import.meta.env.DEV) return true;
  return readLocalStorageFlag();
}

/** Arm diagnostics at runtime (scenario host, reliability harness, console). */
export function setDiagnosticsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.__plethoraDiagnostics = enabled;
}
