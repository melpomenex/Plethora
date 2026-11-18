/**
 * Startup-experience runtime store (companion-store pattern: a tiny zustand
 * store + module-level guards, consumed by the StartupExperience host).
 */

import { create } from "zustand";
import type { KPAnimationMode, Stage } from "./types";

interface StartupExperienceState {
  stage: Stage;
  mode: KPAnimationMode;
  routePainted: boolean;
  markRoutePainted: () => void;
  setStage: (stage: Stage) => void;
  forceExit: () => void;
  /** Unmount cleanup: back to pristine state (the launch claim stays spent). */
  reset: () => void;
}

const INITIAL: Omit<
  StartupExperienceState,
  | "markRoutePainted"
  | "setStage"
  | "forceExit"
  | "reset"
> = {
  stage: "handoff",
  mode: "full",
  routePainted: false,
};

export const useStartupExperienceStore = create<StartupExperienceState>(
  (set) => ({
    ...INITIAL,
    markRoutePainted: () => set({ routePainted: true, stage: "done" }),
    setStage: (stage) => set({ stage }),
    forceExit: () => set({ stage: "aborted" }),
    reset: () => set({ ...INITIAL }),
  })
);

/* ------------------------------------------------------------------ */
/* Once-per-runtime guard (spec: play exactly once per genuine start)  */
/* ------------------------------------------------------------------ */

let launchClaimed = false;

/**
 * Claim this JavaScript runtime's one branded launch. The first call returns
 * true; every later call in the same module lifetime returns false — so
 * internal navigation, window focus, and mobile resume (live JS context)
 * never replay; only a process/webview restart re-evaluates the module.
 */
export function claimLaunch(): boolean {
  if (launchClaimed) return false;
  launchClaimed = true;
  return true;
}

/** Test-only: restore the pristine never-launched module state. */
export function __resetLaunchClaimForTests(): void {
  launchClaimed = false;
}

/* ------------------------------------------------------------------ */
/* Route gating                                                        */
/* ------------------------------------------------------------------ */

/** Utility routes that never arm the branded experience (design D9). */
const UTILITY_ROUTE_PREFIXES = ["#/screenshot-overlay", "#/auth/callback"];

/**
 * True when the given location hash is a main-window launch (catch-all
 * route). `#/screenshot-overlay` and `#/auth/callback` keep the generic
 * PageLoader Suspense fallback instead.
 */
export function shouldArmForRoute(hash: string): boolean {
  const normalized = (hash ?? "").split("?")[0];
  return !UTILITY_ROUTE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}
