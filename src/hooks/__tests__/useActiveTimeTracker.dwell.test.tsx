import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AFK_IDLE_TIMEOUT_MAX_MS,
  AFK_IDLE_TIMEOUT_MIN_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DWELL_EXIT_ACTIONS,
  FLUSH_INTERVAL_MS,
  isDwellExitAction,
  useActiveTimeTracker,
  type DwellExitAction,
  type DwellFlush,
} from "../useActiveTimeTracker";

/**
 * DAQE's dwell contract.
 *
 * The two properties that matter, and that the pre-DAQE tracker did not hold:
 *
 *  - **idle is discarded, not dwell.** A block where the user was away must move
 *    out of the active total, so absence never inflates a reading-time figure.
 *  - **active + idle == elapsed.** Not approximately — exactly, which is what
 *    makes an absent measurement distinguishable from a measured zero.
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
 * Lose window focus for real.
 *
 * jsdom does not update `document.hasFocus()` in response to a synthetic `blur`,
 * and the suite pins it to `true`, so dispatching the event alone would leave the
 * accrual gate fully open and the test would prove nothing.
 */
function blur() {
  act(() => {
    (document.hasFocus as any).mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
  });
}

function refocus() {
  act(() => {
    (document.hasFocus as any).mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
  });
}

/** Pending plus everything already flushed, for a total-observed reading. */
function totalIdle(onFlush: ReturnType<typeof vi.fn>, pending: number): number {
  return sumFlushed(onFlush, "idle") + pending / 1000;
}

type FlushCall = [number, DwellFlush];

function flushes(onFlush: ReturnType<typeof vi.fn>): FlushCall[] {
  return onFlush.mock.calls as FlushCall[];
}

function sumFlushed(onFlush: ReturnType<typeof vi.fn>, key: "active" | "idle"): number {
  return flushes(onFlush).reduce(
    (total, [seconds, details]) =>
      total + (key === "active" ? seconds : details.idleMs / 1000),
    0
  );
}

describe("useActiveTimeTracker dwell contract", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-08-13T09:00:00Z"));
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("idle timeout", () => {
    it("defaults to 45 seconds", () => {
      expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(45_000);
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );

      // Still accruing one second before the threshold. Read total observed, not
      // the pending tail: the 30 s flush cadence has already drained 30 s of it.
      advance(DEFAULT_IDLE_TIMEOUT_MS - 1_000);
      const observed = sumFlushed(onFlush, "active") + result.current.getPendingSeconds();
      expect(observed).toBe(DEFAULT_IDLE_TIMEOUT_MS / 1000 - 1);
      expect(result.current.getPendingIdleMs()).toBe(0);
    });

    it("honours a configured timeout", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
        })
      );

      advance(14_000);
      expect(result.current.getPendingSeconds()).toBe(14);

      // And at the threshold the idle transition happens.
      advance(1_000);
      expect(result.current.getPendingSeconds()).toBe(0);
      expect(result.current.getPendingIdleMs()).toBeGreaterThan(0);
    });

    it("publishes the documented bounds", () => {
      expect(AFK_IDLE_TIMEOUT_MIN_MS).toBe(15_000);
      expect(AFK_IDLE_TIMEOUT_MAX_MS).toBe(120_000);
    });
  });

  describe("idle is discarded, not dwell", () => {
    it("moves the pending tail of the idle block out of the active total", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
        })
      );

      // The transition lands ON the threshold tick, so read one tick earlier for
      // the "still active" state.
      advance(14_000);
      expect(result.current.getPendingSeconds()).toBe(14);

      advance(1_000); // the transition tick
      expect(result.current.getPendingSeconds()).toBe(0);
      // 14 pending seconds plus the transition tick's own second.
      expect(result.current.getPendingIdleMs()).toBe(15_000);
    });

    it("accrues nothing further while idle", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
        })
      );

      advance(15_000); // the transition tick
      advance(60_000); // a minute more away

      expect(result.current.getPendingSeconds()).toBe(0);
      // Total idle, not the pending tail: the 30 s cadence has been flushing it.
      // The whole away span counts, not just the timeout.
      expect(totalIdle(onFlush, result.current.getPendingIdleMs())).toBe(75);
    });

    it("makes active + idle equal the elapsed wall clock", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
        })
      );

      // 15 s reading, 60 s away, 10 s more reading: 85 s observed.
      advance(15_000);
      advance(60_000);
      engage();
      advance(10_000);
      act(() => result.current.flush());

      const active = sumFlushed(onFlush, "active") + result.current.getPendingSeconds();
      const idle = totalIdle(onFlush, result.current.getPendingIdleMs());
      expect(active + idle).toBeCloseTo(85, 0);
      expect(idle).toBeGreaterThan(0);
      // The away block was discarded rather than counted as dwell.
      expect(active).toBeLessThanOrEqual(25);
    });
  });

  describe("re-engagement", () => {
    it("never happens from the passage of time alone", () => {
      const onFlush = vi.fn();
      const onAwayReturn = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
          onAwayReturn,
        })
      );

      advance(15_000);
      advance(120_000); // idle far longer than the flush cadence

      expect(onAwayReturn).not.toHaveBeenCalled();
      expect(result.current.getPendingSeconds()).toBe(0);
    });

    it("requires a confirmed interaction", () => {
      const onFlush = vi.fn();
      const onAwayReturn = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
          onAwayReturn,
        })
      );

      advance(15_000);
      expect(onAwayReturn).not.toHaveBeenCalled();

      engage();
      expect(onAwayReturn).toHaveBeenCalledTimes(1);
      expect(result.current.getPendingSeconds()).toBe(0);
    });

    it("notifies once per idle episode", () => {
      const onFlush = vi.fn();
      const onAwayReturn = vi.fn();
      renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
          onAwayReturn,
        })
      );

      for (let episode = 0; episode < 3; episode += 1) {
        advance(15_000);
        engage();
        advance(5_000);
      }
      expect(onAwayReturn).toHaveBeenCalledTimes(3);
    });

    it("gives each notice a distinct id, so a re-render cannot replay it", () => {
      const onFlush = vi.fn();
      const onAwayReturn = vi.fn();
      renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
          onAwayReturn,
        })
      );

      advance(15_000);
      engage();
      advance(15_000);
      engage();

      const ids = onAwayReturn.mock.calls.map(([return_]) => return_.noticeId);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe("focus and visibility", () => {
    it("pauses accrual when the window loses focus", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(3_000);
      const before = sumFlushed(onFlush, "active") + result.current.getPendingSeconds();
      expect(before).toBe(3);

      blur();
      // Blur banks what accrued, so the pending tail is zero and stays zero.
      advance(10_000);

      expect(result.current.getPendingSeconds()).toBe(0);
      const after = sumFlushed(onFlush, "active") + result.current.getPendingSeconds();
      expect(after).toBe(before);
    });

    it("resumes accruing when focus returns", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(2_000);
      blur();
      advance(10_000);
      refocus();
      advance(3_000);

      const total = sumFlushed(onFlush, "active") + result.current.getPendingSeconds();
      expect(total).toBe(5);
    });

    it("does not attribute the unfocused period as dwell", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(3_000);
      blur();
      advance(120_000);
      act(() => result.current.flush());

      const total = sumFlushed(onFlush, "active") + sumFlushed(onFlush, "idle");
      expect(total).toBeLessThanOrEqual(3);
      expect(totalIdle(onFlush, result.current.getPendingIdleMs())).toBe(0);
    });
  });

  describe("interaction evidence", () => {
    it("records traversal monotonically, in [0,1]", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );

      act(() => {
        result.current.reportTraversal(0.3);
        result.current.reportTraversal(0.7);
        result.current.reportTraversal(0.5); // stale report must not regress
        result.current.reportTraversal(Number.NaN); // ignored
        result.current.reportTraversal(4); // clamped
      });
      advance(2_000);
      act(() => result.current.flush());

      expect(flushes(onFlush).at(-1)?.[1].scrollDepthRatio).toBe(1);
    });

    it("reports approximately 0.7 at 70% traversal", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      act(() => result.current.reportTraversal(0.7));
      advance(2_000);
      act(() => result.current.flush());
      expect(flushes(onFlush).at(-1)?.[1].scrollDepthRatio).toBeCloseTo(0.7);
    });

    it("does not infer traversal from engagement events", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(3_000);
      for (let i = 0; i < 20; i += 1) engage();
      act(() => result.current.flush());

      // A pointer move is a hint of engagement, not evidence of traversal.
      expect(flushes(onFlush).at(-1)?.[1].scrollDepthRatio).toBeUndefined();
    });

    it("reports interactions per minute of observed time", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      act(() => {
        result.current.recordInteraction();
        result.current.recordInteraction();
      });
      advance(60_000);
      act(() => result.current.flush());
      // Two interactions over one minute.
      expect(flushes(onFlush).at(-1)?.[1].interactionDensity).toBeCloseTo(2);
    });

    it("omits the density when nothing happened", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(5_000);
      act(() => result.current.flush());
      expect(flushes(onFlush).at(-1)?.[1].interactionDensity).toBeUndefined();
    });
  });

  describe("exit action", () => {
    it("carries a valid action with the flush that ends the session", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(2_000);
      act(() => result.current.setExitAction("extract-created"));
      act(() => result.current.flush());

      expect(flushes(onFlush).at(-1)?.[1].exitAction).toBe("extract-created");
    });

    it("does not resend a consumed exit action on the next flush", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(2_000);
      act(() => result.current.setExitAction("next-item"));
      act(() => result.current.flush());
      advance(2_000);
      act(() => result.current.flush());

      expect(flushes(onFlush).at(-1)?.[1].exitAction).toBeUndefined();
    });

    it("refuses an unrecognised action", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(2_000);
      act(() => {
        (result.current.setExitAction as (a: string) => void)("teleported-away");
      });
      act(() => result.current.flush());
      expect(flushes(onFlush).at(-1)?.[1].exitAction).toBeUndefined();
    });

    it("names exactly the six documented actions", () => {
      expect([...DWELL_EXIT_ACTIONS]).toEqual([
        "extract-created",
        "next-item",
        "postpone",
        "dismiss",
        "re-prioritize",
        "session-end",
      ]);
      for (const action of DWELL_EXIT_ACTIONS) {
        expect(isDwellExitAction(action)).toBe(true);
      }
      expect(isDwellExitAction("teleported-away")).toBe(false);
      expect(isDwellExitAction(null)).toBe(false);
      expect(isDwellExitAction(42)).toBe(false);
    });
  });

  describe("unchanged behaviour", () => {
    it("keeps the 1 second heartbeat", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(10_000);
      expect(result.current.getPendingSeconds()).toBe(10);
    });

    it("keeps the 30 second flush cadence", () => {
      const onFlush = vi.fn();
      renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(FLUSH_INTERVAL_MS - 1_000);
      expect(onFlush).not.toHaveBeenCalled();
      advance(1_000);
      expect(onFlush).toHaveBeenCalled();
    });

    it("flushes pending seconds when the item changes", () => {
      const onFlush = vi.fn();
      const { rerender } = renderHook(
        ({ itemKey }) => useActiveTimeTracker({ isActive: true, onFlush, itemKey }),
        { initialProps: { itemKey: "doc-1" } }
      );
      advance(4_000);
      rerender({ itemKey: "doc-2" });
      expect(sumFlushed(onFlush, "active")).toBe(4);
    });

    it("flushes on blur", () => {
      const onFlush = vi.fn();
      renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(5_000);
      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      expect(sumFlushed(onFlush, "active")).toBe(5);
    });

    it("flushes on unmount", () => {
      const onFlush = vi.fn();
      const { unmount } = renderHook(() =>
        useActiveTimeTracker({ isActive: true, onFlush, itemKey: "doc-1" })
      );
      advance(6_000);
      unmount();
      expect(sumFlushed(onFlush, "active")).toBe(6);
    });

    it("flushes an idle-only interval, so being away is still recorded", () => {
      const onFlush = vi.fn();
      const { result } = renderHook(() =>
        useActiveTimeTracker({
          isActive: true,
          onFlush,
          itemKey: "doc-1",
          idleTimeoutMs: 15_000,
        })
      );
      advance(15_000); // the transition tick
      // Move the clock past the flush cadence so the interval fires with zero
      // active seconds and a non-zero idle total.
      advance(FLUSH_INTERVAL_MS);

      const idleOnly = flushes(onFlush).filter(([seconds]) => seconds === 0);
      expect(idleOnly.length).toBeGreaterThan(0);
      expect(idleOnly.at(-1)?.[1].idleMs).toBeGreaterThan(0);
    });
  });
});