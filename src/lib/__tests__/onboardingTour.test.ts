import { describe, expect, test, beforeEach } from "vitest";
import {
  FRESH_ONBOARDING_TOUR_STATE,
  ONBOARDING_TOUR_LAUNCH_BUDGET,
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
