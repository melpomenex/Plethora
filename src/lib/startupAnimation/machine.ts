/**
 * Knowledge Peck lifecycle state machine (design D3) — a pure function.
 * No timers, no DOM, no store access; the component owns the clock.
 *
 * Normative transition table:
 *
 * | From        | Event                    | To          |
 * |-------------|--------------------------|-------------|
 * | —           | MOUNTED                  | handoff     |
 * | handoff     | (driver start → setStage)| choreography|
 * | choreography| APP_READY                | resolve     | (via acceleration plan, D4)
 * | choreography| timeline exhausted       | idle        | (driver: no APP_READY yet)
 * | idle        | APP_READY                | resolve     |
 * | handoff     | APP_READY                | resolve     | (ready before mount: epilogue only)
 * | resolve     | timeline end             | reveal      | (pointer-events released here)
 * | reveal      | timeline end (250 ms)    | done        |
 * | any*        | APP_ERROR / WATCHDOG / FORCE_EXIT | aborted |
 * | handoff     | SETTINGS_OFF             | aborted     | (kill switch: hide immediately)
 *
 * * terminal stages are idempotent: `done` absorbs every event; `aborted`
 * absorbs every event except nothing — it is also terminal.
 *
 * The handoff→choreography step is a driver decision (first rAF), expressed
 * through the store's setStage action rather than an event, because whether
 * choreography may start depends on the animation mode (D8), not on readiness.
 */

import type { KPAnimationMode, KPEvent, Stage } from "./types";

/** Hard backstop: the overlay can never outlive this, regardless of stores. */
export const WATCHDOG_MS = 15_000;

/** Stages the machine will never leave (terminal idempotence). */
export const TERMINAL_STAGES: readonly Stage[] = ["done", "aborted"];

export function isTerminal(stage: Stage): boolean {
  return stage === "done" || stage === "aborted";
}

/** Stages during which the component runs its single rAF loop. */
export const ANIMATING_STAGES: readonly Stage[] = ["choreography", "resolve", "reveal"];

export function isAnimating(stage: Stage): boolean {
  return stage === "choreography" || stage === "resolve" || stage === "reveal";
}

const ABORT_EVENTS: readonly KPEvent[] = ["APP_ERROR", "WATCHDOG", "SETTINGS_OFF", "FORCE_EXIT"];

/**
 * Pure transition. Unknown combinations are no-ops (the machine never moves
 * backwards), so callers can dispatch events unconditionally.
 */
export function transition(stage: Stage, event: KPEvent): Stage {
  if (stage === "done") return "done";
  if (stage === "aborted") return "aborted";

  if (event === "MOUNTED") return "handoff";

  if (ABORT_EVENTS.includes(event)) return "aborted";

  // event === "APP_READY"
  switch (stage) {
    case "handoff":
    case "choreography":
    case "idle":
      return "resolve";
    default:
      // resolve/reveal already heading out; APP_READY changes nothing.
      return stage;
  }
}

/**
 * D8 gating precedence, resolved once at overlay mount:
 * kill switch → none; e-ink → stepped stills; reduced motion → static variant
 * (e-ink already forces reducedMotion, hence checked first); else full.
 * `interface.animationsEnabled` deliberately does NOT gate this feature.
 */
export function resolveAnimationMode(input: {
  startupAnimationEnabled: boolean;
  isEinkMode: boolean;
  reducedMotion: boolean;
}): KPAnimationMode {
  if (!input.startupAnimationEnabled) return "none";
  if (input.isEinkMode) return "eink";
  if (input.reducedMotion) return "reduced-motion";
  return "full";
}
