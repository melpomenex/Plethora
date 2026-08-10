import { describe, expect, test, beforeEach } from "vitest";
import {
  FRESH_ONBOARDING_TOUR_STATE,
  ONBOARDING_TOUR_LAUNCH_BUDGET,
  ONBOARDING_TOUR_OPTOUT_STORAGE_KEY,
  ONBOARDING_TOUR_STORAGE_KEY,
  ONBOARDING_TOUR_VERSION,
  incrementLaunchCount,
  markCompleted,
  markDismissed,
  markOptedOut,
  markSkipped,
  readOnboardingTourState,
  recordResumePosition,
  resetOnboardingState,
  shouldAutoDisplay,
  writeOnboardingTourState,
  type OnboardingTourState,
} from "../onboardingTour";

function seed(state: Partial<OnboardingTourState>): void {
  writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, ...state });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("onboardingTour policy", () => {
  test("missing key → fresh-install defaults", () => {
    expect(readOnboardingTourState()).toEqual(FRESH_ONBOARDING_TOUR_STATE);
    expect(readOnboardingTourState().launchCount).toBe(0);
    expect(readOnboardingTourState().autoDisplayDisabled).toBe(false);
  });

  test("unparseable JSON → fresh-install defaults", () => {
    window.localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "{not json");
    expect(readOnboardingTourState()).toEqual(FRESH_ONBOARDING_TOUR_STATE);
  });

  test("partial record missing fields → fresh-install defaults", () => {
    window.localStorage.setItem(
      ONBOARDING_TOUR_STORAGE_KEY,
      JSON.stringify({ version: ONBOARDING_TOUR_VERSION, launchCount: 2 }),
    );
    expect(readOnboardingTourState()).toEqual(FRESH_ONBOARDING_TOUR_STATE);
  });

  test("future-version record → auto-display suppressed, not reset", () => {
    const future = {
      version: ONBOARDING_TOUR_VERSION + 5,
      launchCount: 1,
      autoDisplayDisabled: false,
      furthestStepId: "import-docs",
      completedAt: null,
    };
    window.localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, JSON.stringify(future));
    const state = readOnboardingTourState();
    expect(state.version).toBe(ONBOARDING_TOUR_VERSION + 5);
    expect(state.autoDisplayDisabled).toBe(true);
    expect(state.furthestStepId).toBe("import-docs");
    expect(state.launchCount).toBe(1);
  });

  test("older-version well-formed record migrates forward, preserving fields", () => {
    const older = {
      version: ONBOARDING_TOUR_VERSION - 1,
      launchCount: 2,
      autoDisplayDisabled: false,
      furthestStepId: "import-docs",
      completedAt: null,
    };
    window.localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, JSON.stringify(older));
    const state = readOnboardingTourState();
    expect(state.version).toBe(ONBOARDING_TOUR_VERSION);
    expect(state.launchCount).toBe(2);
    expect(state.autoDisplayDisabled).toBe(false);
    expect(state.furthestStepId).toBe("import-docs");
    expect(state.completedAt).toBeNull();
  });

  test("older-version terminal/exhausted record stays terminal/exhausted after migration", () => {
    const olderExhausted = {
      version: ONBOARDING_TOUR_VERSION - 1,
      launchCount: ONBOARDING_TOUR_LAUNCH_BUDGET,
      autoDisplayDisabled: true,
      furthestStepId: null,
      completedAt: "2026-01-01T00:00:00.000Z",
    };
    window.localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, JSON.stringify(olderExhausted));
    const state = readOnboardingTourState();
    expect(state.version).toBe(ONBOARDING_TOUR_VERSION);
    expect(shouldAutoDisplay(state)).toBe(false);
    expect(state.autoDisplayDisabled).toBe(true);
    expect(state.completedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("older-version record with a malformed field is still treated as corrupt, not migrated", () => {
    const olderMalformed = {
      version: ONBOARDING_TOUR_VERSION - 1,
      launchCount: "two", // wrong type
      autoDisplayDisabled: false,
      furthestStepId: null,
      completedAt: null,
    };
    window.localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, JSON.stringify(olderMalformed));
    expect(readOnboardingTourState()).toEqual(FRESH_ONBOARDING_TOUR_STATE);
  });

  test("launch budget of 3 — shouldAutoDisplay flips at the boundary", () => {
    expect(ONBOARDING_TOUR_LAUNCH_BUDGET).toBe(3);
    seed({ launchCount: 0 });
    expect(shouldAutoDisplay(readOnboardingTourState())).toBe(true);
    seed({ launchCount: 1 });
    expect(shouldAutoDisplay(readOnboardingTourState())).toBe(true);
    seed({ launchCount: 2 });
    expect(shouldAutoDisplay(readOnboardingTourState())).toBe(true);
    seed({ launchCount: 3 });
    expect(shouldAutoDisplay(readOnboardingTourState())).toBe(false);
  });

  test("incrementLaunchCount increments by exactly one per call", () => {
    seed({ launchCount: 0 });
    incrementLaunchCount();
    incrementLaunchCount();
    incrementLaunchCount();
    expect(readOnboardingTourState().launchCount).toBe(3);
    incrementLaunchCount();
    expect(readOnboardingTourState().launchCount).toBe(4);
  });

  test("explicit skip is terminal — disables auto-display", () => {
    seed({ launchCount: 1 });
    const next = markSkipped();
    expect(next.autoDisplayDisabled).toBe(true);
    expect(shouldAutoDisplay(next)).toBe(false);
    // budget itself is preserved (not the gating field)
    expect(next.launchCount).toBe(1);
  });

  test("opt-out is terminal — same effect as skip", () => {
    seed({ launchCount: 1 });
    const next = markOptedOut();
    expect(next.autoDisplayDisabled).toBe(true);
    expect(shouldAutoDisplay(next)).toBe(false);
  });

  test("completion is terminal — disables auto-display and stamps completedAt", () => {
    seed({ launchCount: 1, furthestStepId: "last-step" });
    const next = markCompleted();
    expect(next.autoDisplayDisabled).toBe(true);
    expect(next.completedAt).not.toBeNull();
    expect(next.furthestStepId).toBeNull();
    expect(shouldAutoDisplay(next)).toBe(false);
  });

  test("soft dismissal (Esc / overlay) preserves budget and terminal flag", () => {
    seed({ launchCount: 1 });
    const next = markDismissed("step-4");
    expect(next.autoDisplayDisabled).toBe(false);
    expect(next.launchCount).toBe(1);
    expect(next.furthestStepId).toBe("step-4");
    expect(shouldAutoDisplay(next)).toBe(true);
  });

  test("soft dismissal without a step id keeps prior resume position", () => {
    seed({ launchCount: 1, furthestStepId: "step-2" });
    const next = markDismissed();
    expect(next.furthestStepId).toBe("step-2");
  });

  test("recordResumePosition advances the pointer while non-terminal", () => {
    seed({ launchCount: 1 });
    recordResumePosition("step-3");
    expect(readOnboardingTourState().furthestStepId).toBe("step-3");
    recordResumePosition("step-5");
    expect(readOnboardingTourState().furthestStepId).toBe("step-5");
  });

  test("recordResumePosition is a no-op once terminal", () => {
    seed({ launchCount: 1, autoDisplayDisabled: true, furthestStepId: "step-2" });
    recordResumePosition("step-9");
    expect(readOnboardingTourState().furthestStepId).toBe("step-2");
  });

  test("resetOnboardingState restores fresh-install defaults", () => {
    seed({ launchCount: 3, autoDisplayDisabled: true, furthestStepId: "x", completedAt: "2026-01-01" });
    const next = resetOnboardingState();
    expect(next).toEqual(FRESH_ONBOARDING_TOUR_STATE);
    expect(readOnboardingTourState()).toEqual(FRESH_ONBOARDING_TOUR_STATE);
  });

  test("terminal state blocks incrementLaunchCount (defence in depth)", () => {
    seed({ launchCount: 1, autoDisplayDisabled: true });
    const next = incrementLaunchCount();
    expect(next.launchCount).toBe(1);
  });

  test("write/read round-trips a same-version record", () => {
    const state: OnboardingTourState = {
      version: ONBOARDING_TOUR_VERSION,
      launchCount: 2,
      autoDisplayDisabled: false,
      furthestStepId: "step-7",
      completedAt: null,
    };
    writeOnboardingTourState(state);
    expect(readOnboardingTourState()).toEqual(state);
  });

  test("fresh-install state is auto-display eligible", () => {
    expect(shouldAutoDisplay(FRESH_ONBOARDING_TOUR_STATE)).toBe(true);
  });
});

describe("onboardingTour opt-out tombstone (sync-clobber resilience)", () => {
  test("markSkipped sets the tombstone", () => {
    seed({ launchCount: 1 });
    markSkipped();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_OPTOUT_STORAGE_KEY)).toBe("1");
  });

  test("markCompleted sets the tombstone", () => {
    seed({ launchCount: 1 });
    markCompleted();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_OPTOUT_STORAGE_KEY)).toBe("1");
  });

  test("markOptedOut sets the tombstone", () => {
    seed({ launchCount: 1 });
    markOptedOut();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_OPTOUT_STORAGE_KEY)).toBe("1");
  });

  test("soft dismissal does NOT set the tombstone", () => {
    seed({ launchCount: 1 });
    markDismissed("step-2");
    expect(window.localStorage.getItem(ONBOARDING_TOUR_OPTOUT_STORAGE_KEY)).toBeNull();
  });

  test("a stale sync replay clobbering the record back to enabled still stays opted out", () => {
    // The user opted out.
    seed({ launchCount: 1 });
    markSkipped();
    expect(shouldAutoDisplay(readOnboardingTourState())).toBe(false);

    // Simulate a stale last-writer-wins replay from the sync layer: the
    // synced `incrementum-onboarding-tour` record overwrites localStorage
    // with a pre-opt-out snapshot that has autoDisplayDisabled: false.
    window.localStorage.setItem(
      ONBOARDING_TOUR_STORAGE_KEY,
      JSON.stringify({
        version: ONBOARDING_TOUR_VERSION,
        launchCount: 1,
        autoDisplayDisabled: false,
        furthestStepId: null,
        completedAt: null,
      }),
    );

    // The tombstone keeps the user's decision intact.
    const state = readOnboardingTourState();
    expect(state.autoDisplayDisabled).toBe(true);
    expect(shouldAutoDisplay(state)).toBe(false);
  });

  test("the tombstone forces disabled even if the main record is missing entirely", () => {
    // Edge case: main record nuked by corruption, but tombstone survives.
    seed({ launchCount: 1 });
    markSkipped();
    window.localStorage.removeItem(ONBOARDING_TOUR_STORAGE_KEY);

    const state = readOnboardingTourState();
    expect(state.autoDisplayDisabled).toBe(true);
    expect(shouldAutoDisplay(state)).toBe(false);
  });

  test("resetOnboardingState clears the tombstone so auto-display can resume", () => {
    seed({ launchCount: 1 });
    markSkipped();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_OPTOUT_STORAGE_KEY)).toBe("1");

    resetOnboardingState();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_OPTOUT_STORAGE_KEY)).toBeNull();
    expect(shouldAutoDisplay(readOnboardingTourState())).toBe(true);
  });

  test("without a tombstone, a fresh record is unaffected", () => {
    seed({ launchCount: 0 });
    expect(window.localStorage.getItem(ONBOARDING_TOUR_OPTOUT_STORAGE_KEY)).toBeNull();
    const state = readOnboardingTourState();
    expect(state.autoDisplayDisabled).toBe(false);
    expect(shouldAutoDisplay(state)).toBe(true);
  });
});
