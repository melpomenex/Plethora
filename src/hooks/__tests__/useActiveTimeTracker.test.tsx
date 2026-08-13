import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLUSH_INTERVAL_MS,
  IDLE_THRESHOLD_MS,
  useActiveTimeTracker,
} from "../useActiveTimeTracker";

/**
 * Advance fake timers by `ms`, keeping `Date.now()` in step — the hook reads
 * the clock to decide whether the user has gone idle, so a timer-only advance
 * would never trip the idle threshold.
 */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function engage() {
  act(() => {
    window.dispatchEvent(new Event("pointermove"));
  });
}

/**
 * Every second the tracker observed: what it has already flushed plus what is
 * still pending. Asserting on pending alone is wrong for anything running
 * longer than one flush interval, because the cadence drains it.
 */
function totalObserved(onFlush: ReturnType<typeof vi.fn>, pending: number): number {
  const flushed = onFlush.mock.calls.reduce((sum, [seconds]) => sum + (seconds as number), 0);
  return flushed + pending;
}

describe("useActiveTimeTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-08-13T09:00:00Z"));
    // jsdom reports the window as unfocused by default, which would make
    // every test accrue nothing. Focused-and-visible is the baseline; the
    // tests that care override it explicitly.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("accrues one second per second while engaged", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
    );

    advance(5_000);

    expect(result.current.getPendingSeconds()).toBe(5);
  });

  it("excludes idle time past the threshold", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
    );

    // Four active minutes, kept alive by periodic engagement.
    for (let i = 0; i < 8; i += 1) {
      advance(30_000);
      engage();
    }
    expect(totalObserved(onFlush, result.current.getPendingSeconds())).toBe(240);

    // Then three untouched hours.
    advance(3 * 60 * 60 * 1000);
    const total = totalObserved(onFlush, result.current.getPendingSeconds());

    // Accrual stops one tick before the threshold is reached, so the tail is
    // the threshold minus that tick — bounded, and nowhere near three hours.
    expect(total).toBe(240 + IDLE_THRESHOLD_MS / 1000 - 1);
    expect(total).toBeLessThan(240 + IDLE_THRESHOLD_MS / 1000);
  });

  it("accrues nothing while the window is blurred", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
    );

    advance(20 * 60 * 1000);

    expect(result.current.getPendingSeconds()).toBe(0);
  });

  it("accrues nothing while the document is hidden", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
    );

    advance(60_000);

    expect(result.current.getPendingSeconds()).toBe(0);
  });

  it("keeps accruing during media playback with no input", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "audio-1" })
    );

    // A 40-minute chapter: playback progress is the only signal, and it is
    // far apart enough that pointer/key idleness would otherwise stop the
    // clock several times over.
    for (let i = 0; i < 80; i += 1) {
      advance(30_000);
      act(() => {
        result.current.notifyEngagement();
      });
    }

    expect(totalObserved(onFlush, result.current.getPendingSeconds())).toBe(40 * 60);
  });

  it("only the foreground item accrues when two are mounted", () => {
    const foregroundFlush = vi.fn();
    const backgroundFlush = vi.fn();

    const foreground = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush: foregroundFlush, itemKey: "doc-1" })
    );
    const background = renderHook(() =>
      useActiveTimeTracker({ isActive: false, onFlush: backgroundFlush, itemKey: "doc-2" })
    );

    advance(10_000);

    expect(foreground.result.current.getPendingSeconds()).toBe(10);
    expect(background.result.current.getPendingSeconds()).toBe(0);
  });

  it("flushes on the cadence without waiting for the end", () => {
    const onFlush = vi.fn();
    renderHook(() => useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" }));

    advance(FLUSH_INTERVAL_MS);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(FLUSH_INTERVAL_MS / 1000);
  });

  it("never flushes zero", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const onFlush = vi.fn();
    renderHook(() => useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" }));

    advance(FLUSH_INTERVAL_MS * 3);

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("flushes on blur, on visibility loss, and on beforeunload", () => {
    const onFlush = vi.fn();
    renderHook(() => useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" }));

    advance(3_000);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(onFlush).toHaveBeenLastCalledWith(3);

    engage();
    advance(4_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onFlush).toHaveBeenLastCalledWith(4);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    engage();
    advance(2_000);
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(onFlush).toHaveBeenLastCalledWith(2);
  });

  it("flushes against the previous item when the item changes", () => {
    const onFlush = vi.fn();
    const { rerender } = renderHook(
      ({ itemKey }) => useActiveTimeTracker({ isActive: true, onFlush, itemKey }),
      { initialProps: { itemKey: "doc-1" } }
    );

    advance(7_000);
    act(() => {
      rerender({ itemKey: "doc-2" });
    });

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(7);
  });

  it("flushes the tail on unmount", () => {
    const onFlush = vi.fn();
    const { unmount } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
    );

    advance(9_000);
    act(() => {
      unmount();
    });

    expect(onFlush).toHaveBeenCalledWith(9);
  });

  it("banks accrued time when the item leaves the foreground", () => {
    const onFlush = vi.fn();
    const { rerender } = renderHook(
      ({ isActive }) => useActiveTimeTracker({ isActive, onFlush, itemKey: "doc-1" }),
      { initialProps: { isActive: true } }
    );

    advance(6_000);
    act(() => {
      rerender({ isActive: false });
    });

    expect(onFlush).toHaveBeenCalledWith(6);
  });

  it("does not double-count seconds already flushed", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
    );

    advance(5_000);
    act(() => {
      result.current.flush();
    });
    expect(result.current.getPendingSeconds()).toBe(0);

    act(() => {
      result.current.flush();
    });
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("accrues nothing when disabled", () => {
    const onFlush = vi.fn();
    const { result } = renderHook(() =>
      useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1", enabled: false })
    );

    advance(60_000);

    expect(result.current.getPendingSeconds()).toBe(0);
    expect(onFlush).not.toHaveBeenCalled();
  });
});
