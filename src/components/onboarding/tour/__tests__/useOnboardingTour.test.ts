import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useOnboardingTour } from "../useOnboardingTour";
import {
  FRESH_ONBOARDING_TOUR_STATE,
  ONBOARDING_TOUR_STORAGE_KEY,
  writeOnboardingTourState,
} from "../../../../lib/onboardingTour";
import type { TourChapter } from "../types";

beforeEach(() => {
  window.localStorage.clear();
});

const chapters: TourChapter[] = [
  {
    id: "welcome",
    labelKey: "onboarding.tour.welcome",
    steps: [
      { id: "welcome-1", titleKey: "t.welcome.1", bodyKey: "b.welcome.1" },
    ],
  },
  {
    id: "import",
    labelKey: "onboarding.tour.import",
    steps: [
      {
        id: "import-1",
        titleKey: "t.import.1",
        bodyKey: "b.import.1",
        // No anchor declared → centred card, always resolvable.
      },
      {
        id: "import-2",
        titleKey: "t.import.2",
        bodyKey: "b.import.2",
        // requiresAnchor:true but no DOM anchor → must be dropped.
        requiresAnchor: true,
        anchor: "documents-import-button" as any,
      },
    ],
  },
  {
    id: "queue",
    labelKey: "onboarding.tour.queue",
    steps: [
      {
        id: "queue-1",
        titleKey: "t.queue.1",
        bodyKey: "b.queue.1",
        requiresAnchor: true,
        // Provide a candidate list; both are absent in this test so the
        // step must drop.
        anchor: ["nav-queue", "mobile-nav-queue"] as any,
      },
      { id: "queue-2", titleKey: "t.queue.2", bodyKey: "b.queue.2" },
    ],
  },
];

function renderTour() {
  return renderHook(() => useOnboardingTour(chapters)).result;
}

describe("useOnboardingTour engine", () => {
  test("resolvable list excludes requiresAnchor steps whose anchors are absent", () => {
    const result = renderTour();
    expect(result.current.totalSteps).toBe(3); // welcome-1, import-1, queue-2
  });

  test("next/back advance through resolvable steps only", () => {
    const result = renderTour();
    act(() => result.current.openTour());
    expect(result.current.currentStep?.id).toBe("welcome-1");
    act(() => result.current.next());
    expect(result.current.currentStep?.id).toBe("import-1");
    act(() => result.current.next());
    expect(result.current.currentStep?.id).toBe("queue-2");
    // On the last step, next is a no-op.
    act(() => result.current.next());
    expect(result.current.currentStep?.id).toBe("queue-2");
    act(() => result.current.back());
    expect(result.current.currentStep?.id).toBe("import-1");
  });

  test("Back is a no-op on the first step", () => {
    const result = renderTour();
    act(() => result.current.openTour());
    expect(result.current.isFirstStep).toBe(true);
    act(() => result.current.back());
    expect(result.current.currentIndex).toBe(0);
  });

  test("isLastStep is true on the final step", () => {
    const result = renderTour();
    act(() => result.current.openTour());
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.isLastStep).toBe(true);
  });

  test("Done marks the tour completed (terminal)", () => {
    const result = renderTour();
    act(() => result.current.openTour());
    act(() => result.current.next());
    act(() => result.current.next());
    act(() => result.current.close("done"));
    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
    expect(stored.autoDisplayDisabled).toBe(true);
    expect(stored.completedAt).not.toBeNull();
  });

  test("Skip is terminal but not completed", () => {
    const result = renderTour();
    act(() => result.current.openTour());
    act(() => result.current.close("skip"));
    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
    expect(stored.autoDisplayDisabled).toBe(true);
    expect(stored.completedAt).toBeNull();
  });

  test("Dismiss is soft — preserves terminal flag and budget", () => {
    writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: 1 });
    const result = renderTour();
    act(() => result.current.openTour());
    act(() => result.current.next());
    act(() => result.current.close("dismiss"));
    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
    expect(stored.autoDisplayDisabled).toBe(false);
    expect(stored.launchCount).toBe(1);
    expect(stored.furthestStepId).toBe("import-1");
  });

  test("Resume reopens at the stored furthest step", () => {
    writeOnboardingTourState({
      ...FRESH_ONBOARDING_TOUR_STATE,
      furthestStepId: "queue-2",
    });
    const result = renderTour();
    act(() => result.current.openTour());
    expect(result.current.currentStep?.id).toBe("queue-2");
  });

  test("Stored step id absent from current definition falls back to step 1", () => {
    writeOnboardingTourState({
      ...FRESH_ONBOARDING_TOUR_STATE,
      furthestStepId: "no-such-step",
    });
    const result = renderTour();
    act(() => result.current.openTour());
    expect(result.current.currentStep?.id).toBe("welcome-1");
  });

  test("Completed tour restarts from step 1 on demand", () => {
    writeOnboardingTourState({
      ...FRESH_ONBOARDING_TOUR_STATE,
      furthestStepId: "queue-2",
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = renderTour();
    act(() => result.current.openTour());
    expect(result.current.currentStep?.id).toBe("welcome-1");
  });

  test("Replay with reset clears the resume position but not the terminal flag", () => {
    writeOnboardingTourState({
      ...FRESH_ONBOARDING_TOUR_STATE,
      furthestStepId: "queue-2",
      autoDisplayDisabled: true,
      completedAt: "2026-01-01T00:00:00.000Z",
      launchCount: 3,
    });
    const result = renderTour();
    act(() => result.current.openTour({ reset: true }));
    expect(result.current.currentStep?.id).toBe("welcome-1");
    const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
    expect(stored.furthestStepId).toBeNull();
    // Policy flags untouched by on-demand replay (spec).
    expect(stored.autoDisplayDisabled).toBe(true);
    expect(stored.launchCount).toBe(3);
  });

  test("Jump to chapter lands on the first resolvable step of that chapter", () => {
    const result = renderTour();
    act(() => result.current.openTour());
    // Chapter 2 (queue) has its first step dropped, so the jump must land
    // on the chapter's only resolvable step: queue-2.
    act(() => result.current.jumpToChapter(2));
    expect(result.current.currentStep?.id).toBe("queue-2");
  });

  test("currentChapterIndex tracks the active chapter", () => {
    const result = renderTour();
    act(() => result.current.openTour());
    expect(result.current.currentChapterIndex).toBe(0);
    act(() => result.current.next());
    expect(result.current.currentChapterIndex).toBe(1);
    act(() => result.current.jumpToChapter(2));
    expect(result.current.currentChapterIndex).toBe(2);
  });

  test("Navigation adapter receives capture/restore/navigate calls", () => {
    const captured = { marker: "before" };
    const adapter = {
      captureView: vi.fn(() => captured),
      restoreView: vi.fn(),
      navigateTo: vi.fn(),
    };
    const result = renderHook(() => useOnboardingTour(chapters, adapter)).result;
    act(() => result.current.openTour());
    expect(adapter.captureView).toHaveBeenCalled();
    act(() => result.current.close("dismiss"));
    expect(adapter.restoreView).toHaveBeenCalledWith(captured);
  });
});
