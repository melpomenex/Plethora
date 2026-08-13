import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLUSH_INTERVAL_MS, IDLE_THRESHOLD_MS } from "../useActiveTimeTracker";
import { useQueueTimeTracker, type QueueTimedTarget } from "../useQueueTimeTracker";

const recordActiveTime = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../api/item-stats", () => ({ recordActiveTime }));

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

const doc = (id: string): QueueTimedTarget => ({ itemType: "document", itemId: id });

describe("useQueueTimeTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date("2026-08-13T09:00:00Z"));
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    recordActiveTime.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hands the rating call the active seconds, not wall-clock", () => {
    const { result } = renderHook(() => useQueueTimeTracker("item-1", doc("doc-1")));

    // Two engaged minutes, then the user walks away for an hour.
    for (let i = 0; i < 4; i += 1) {
      advance(30_000);
      engage();
    }
    advance(60 * 60 * 1000);

    const seconds = result.current.consumeActiveSeconds();
    expect(seconds).toBe(120 + IDLE_THRESHOLD_MS / 1000 - 1);
    expect(seconds).toBeLessThan(180);
  });

  it("does not also send rated seconds as unrated time", () => {
    const { result, rerender } = renderHook(
      ({ itemKey, target }) => useQueueTimeTracker(itemKey, target),
      { initialProps: { itemKey: "item-1", target: doc("doc-1") } },
    );

    advance(FLUSH_INTERVAL_MS);
    act(() => {
      result.current.consumeActiveSeconds();
    });

    // Rating advances the queue to the next item.
    act(() => {
      rerender({ itemKey: "item-2", target: doc("doc-2") });
    });

    expect(recordActiveTime).not.toHaveBeenCalled();
  });

  it("records time for an item the user skipped past without rating", () => {
    const { rerender } = renderHook(
      ({ itemKey, target }) => useQueueTimeTracker(itemKey, target),
      { initialProps: { itemKey: "item-1", target: doc("doc-1") } },
    );

    advance(12_000);
    act(() => {
      rerender({ itemKey: "item-2", target: doc("doc-2") });
    });

    expect(recordActiveTime).toHaveBeenCalledTimes(1);
    expect(recordActiveTime).toHaveBeenCalledWith("document", "doc-1", "queue", 12);
  });

  it("sends nothing for item types with no cumulative time column", () => {
    const { rerender } = renderHook(
      ({ itemKey, target }: { itemKey: string; target: QueueTimedTarget | null }) =>
        useQueueTimeTracker(itemKey, target),
      { initialProps: { itemKey: "card-1", target: null } },
    );

    advance(12_000);
    act(() => {
      rerender({ itemKey: "card-2", target: null });
    });

    // A flashcard's time reaches the backend through its review, not here.
    expect(recordActiveTime).not.toHaveBeenCalled();
  });

  it("starts each item from zero", () => {
    const { result, rerender } = renderHook(
      ({ itemKey, target }) => useQueueTimeTracker(itemKey, target),
      { initialProps: { itemKey: "item-1", target: doc("doc-1") } },
    );

    advance(20_000);
    act(() => {
      rerender({ itemKey: "item-2", target: doc("doc-2") });
    });
    advance(5_000);

    expect(result.current.consumeActiveSeconds()).toBe(5);
  });

  it("consuming twice returns nothing the second time", () => {
    const { result } = renderHook(() => useQueueTimeTracker("item-1", doc("doc-1")));

    advance(8_000);

    expect(result.current.consumeActiveSeconds()).toBe(8);
    expect(result.current.consumeActiveSeconds()).toBe(0);
  });
});
