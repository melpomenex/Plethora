/**
 * Liveness heartbeat (eliminate-long-running-memory-growth, D9 / task 3.4).
 *
 * The 1 s `data-plethora-heartbeat` interval exists for the reliability
 * harness's ui_hang detection. It previously ran permanently in every build;
 * now it is installed only when the diagnostics/harness gate is armed. The
 * bootstrap-phase twin (src/main-bootstrap.ts) already stops on startup
 * settle and is unchanged.
 */

import { isDiagnosticsEnabled } from "./gate";

let installed = false;

/**
 * Install the heartbeat interval if (and only if) diagnostics are enabled.
 * Idempotent; returns true when the probe is live.
 */
export function installLivenessHeartbeat(): boolean {
  if (installed || typeof document === "undefined") return installed;
  if (!isDiagnosticsEnabled()) return false;
  installed = true;
  let heartbeat = 0;
  window.setInterval(() => {
    heartbeat += 1;
    document.body.setAttribute("data-plethora-heartbeat", String(heartbeat));
  }, 1000);
  return true;
}

/** Test-only: allow re-installation after a gate flip. */
export function resetLivenessHeartbeatForTests(): void {
  installed = false;
}
