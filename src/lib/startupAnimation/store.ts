/**
 * Startup-experience runtime store (companion-store pattern: a tiny zustand
 * store + module-level guards, consumed by the StartupExperience host).
 *
 * `appReady` is the D2 conjunction: startup data ready (ensureStartup
 * reached "ready", which transitively implies the backend-ready gate) AND
 * the main route having painted at least one frame.
 */

import { create } from "zustand";
import type { KPAnimationMode, Stage } from "./types";

interface StartupExperienceState {
  stage: Stage;
  mode: KPAnimationMode;
  dataReady: boolean;
  routePainted: boolean;
  /** Derived conjunction, recomputed by the flag-setting actions. */
  appReady: boolean;
  markDataReady: () => void;
  markDataError: () => void;
  markRoutePainted: () => void;
  setStage: (stage: Stage) => void;
  forceExit: () => void;
  /** Unmount cleanup: back to pristine state (the launch claim stays spent). */
  reset: () => void;
}

const INITIAL: Omit<
  StartupExperienceState,
  | "markDataReady"
  | "markDataError"
  | "markRoutePainted"
  | "setStage"
  | "forceExit"
  | "reset"
> = {
  stage: "handoff",
  mode: "full",
  dataReady: false,
  routePainted: false,
  appReady: false,
};

function withAppReady(
  state: StartupExperienceState,
  patch: Partial<Pick<StartupExperienceState, "dataReady" | "routePainted">>
): Partial<StartupExperienceState> {
  const dataReady = patch.dataReady ?? state.dataReady;
  const routePainted = patch.routePainted ?? state.routePainted;
  return { ...patch, appReady: dataReady && routePainted };
}

export const useStartupExperienceStore = create<StartupExperienceState>(
  (set) => ({
    ...INITIAL,
    markDataReady: () => set((s) => withAppReady(s, { dataReady: true })),
    markDataError: () =>
      set(() => ({ dataReady: false, appReady: false, stage: "aborted" })),
    markRoutePainted: () =>
      set((s) => withAppReady(s, { routePainted: true })),
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
