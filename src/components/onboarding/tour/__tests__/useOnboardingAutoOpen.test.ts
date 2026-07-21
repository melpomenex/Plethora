import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useOnboardingAutoOpen } from "../useOnboardingAutoOpen";
import {
  FRESH_ONBOARDING_TOUR_STATE,
  ONBOARDING_TOUR_STORAGE_KEY,
  writeOnboardingTourState,
} from "../../../../lib/onboardingTour";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Mount a shell-root anchor so the "shell rendered" gate passes. The hook
 * checks `resolveAnchor([TOUR_ANCHORS.shellRoot])` inside a rAF, so the
 * element must exist with a non-zero box.
 */
function mountShellRoot() {
  const el = document.createElement("div");
  el.setAttribute("data-tour", "shell-root");
  el.style.width = "100px";
  el.style.height = "100px";
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      right: 100,
      bottom: 100,
      left: 0,
      width: 100,
      height: 100,
      toJSON: () => {},
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function flushRaf() {
  return new Promise<void>((resolve) => {
    // The hook schedules one rAF; flush it then settle the microtask queue.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("useOnboardingAutoOpen — gate matrix", () => {
  test("opens on launch 1 when all gates pass and increments the budget", async () => {
    writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: 0 });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      renderHook(() =>
        useOnboardingAutoOpen({
          openTour,
          startupNoticePending: false,
          startupNoticeSettled: true,
          isCatchAllRoute: true,
          isDeepLinkedLaunch: false,
        }),
      );
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).toHaveBeenCalledTimes(1);
      const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
      expect(stored.launchCount).toBe(1);
    } finally {
      shell.remove();
    }
  });

  test("opens on launches 2 and 3 (budget boundary)", async () => {
    for (const startingCount of [1, 2]) {
      window.localStorage.clear();
      writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: startingCount });
      const shell = mountShellRoot();
      const openTour = vi.fn();
      try {
        renderHook(() =>
          useOnboardingAutoOpen({
            openTour,
            startupNoticePending: false,
            startupNoticeSettled: true,
            isCatchAllRoute: true,
            isDeepLinkedLaunch: false,
          }),
        );
        await act(async () => {
          await flushRaf();
        });
        expect(openTour).toHaveBeenCalledTimes(1);
      } finally {
        shell.remove();
      }
    }
  });

  test("stays silent on launch 4 (budget exhausted) without consuming more budget", async () => {
    writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: 3 });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      renderHook(() =>
        useOnboardingAutoOpen({
          openTour,
          startupNoticePending: false,
          startupNoticeSettled: true,
          isCatchAllRoute: true,
          isDeepLinkedLaunch: false,
        }),
      );
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).not.toHaveBeenCalled();
      const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
      expect(stored.launchCount).toBe(3);
    } finally {
      shell.remove();
    }
  });

  test("stays silent after completion (terminal)", async () => {
    writeOnboardingTourState({
      ...FRESH_ONBOARDING_TOUR_STATE,
      launchCount: 1,
      autoDisplayDisabled: true,
      completedAt: "2026-01-01T00:00:00.000Z",
    });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      renderHook(() =>
        useOnboardingAutoOpen({
          openTour,
          startupNoticePending: false,
          startupNoticeSettled: true,
          isCatchAllRoute: true,
          isDeepLinkedLaunch: false,
        }),
      );
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).not.toHaveBeenCalled();
    } finally {
      shell.remove();
    }
  });

  test("stays silent after explicit skip (terminal)", async () => {
    writeOnboardingTourState({
      ...FRESH_ONBOARDING_TOUR_STATE,
      launchCount: 1,
      autoDisplayDisabled: true,
    });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      renderHook(() =>
        useOnboardingAutoOpen({
          openTour,
          startupNoticePending: false,
          startupNoticeSettled: true,
          isCatchAllRoute: true,
          isDeepLinkedLaunch: false,
        }),
      );
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).not.toHaveBeenCalled();
    } finally {
      shell.remove();
    }
  });

  test("pending startup notice suppresses the tour and does not consume budget", async () => {
    writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: 0 });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      renderHook(() =>
        useOnboardingAutoOpen({
          openTour,
          startupNoticePending: true,
          startupNoticeSettled: true,
          isCatchAllRoute: true,
          isDeepLinkedLaunch: false,
        }),
      );
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).not.toHaveBeenCalled();
      const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
      expect(stored.launchCount).toBe(0);
    } finally {
      shell.remove();
    }
  });

  test("deep-linked launch suppresses the tour and does not consume budget", async () => {
    writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: 0 });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      renderHook(() =>
        useOnboardingAutoOpen({
          openTour,
          startupNoticePending: false,
          startupNoticeSettled: true,
          isCatchAllRoute: true,
          isDeepLinkedLaunch: true,
        }),
      );
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).not.toHaveBeenCalled();
      const stored = JSON.parse(window.localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY)!);
      expect(stored.launchCount).toBe(0);
    } finally {
      shell.remove();
    }
  });

  test("non-catch-all route suppresses the tour", async () => {
    writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: 0 });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      renderHook(() =>
        useOnboardingAutoOpen({
          openTour,
          startupNoticePending: false,
          startupNoticeSettled: true,
          isCatchAllRoute: false,
          isDeepLinkedLaunch: false,
        }),
      );
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).not.toHaveBeenCalled();
    } finally {
      shell.remove();
    }
  });

  test("opens at most once per session even if gates flip back to eligible", async () => {
    writeOnboardingTourState({ ...FRESH_ONBOARDING_TOUR_STATE, launchCount: 0 });
    const shell = mountShellRoot();
    const openTour = vi.fn();
    try {
      const result = renderHook(
        ({
          startupNoticePending,
          startupNoticeSettled,
        }: {
          startupNoticePending: boolean;
          startupNoticeSettled: boolean;
        }) =>
          useOnboardingAutoOpen({
            openTour,
            startupNoticePending,
            startupNoticeSettled,
            isCatchAllRoute: true,
            isDeepLinkedLaunch: false,
          }),
        {
          initialProps: {
            startupNoticePending: true,
            startupNoticeSettled: false,
          },
        },
      );
      // First: notice pending, no open.
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).not.toHaveBeenCalled();
      // Now notice clears.
      result.rerender({
        startupNoticePending: false,
        startupNoticeSettled: true,
      });
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).toHaveBeenCalledTimes(1);
      // Re-render again — must not re-open.
      result.rerender({
        startupNoticePending: false,
        startupNoticeSettled: true,
      });
      await act(async () => {
        await flushRaf();
      });
      expect(openTour).toHaveBeenCalledTimes(1);
    } finally {
      shell.remove();
    }
  });
});
