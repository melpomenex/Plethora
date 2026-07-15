import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "../useLongPress";

const touchEvent = (x = 20, y = 30) => ({
  touches: [{ clientX: x, clientY: y }],
}) as unknown as React.TouchEvent;

describe("useLongPress", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires after the hold threshold and exposes didFire for click suppression", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, { threshold: 400 }));

    act(() => result.current.onTouchStart(touchEvent()));
    act(() => vi.advanceTimersByTime(399));
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onLongPress).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(result.current.didFire()).toBe(true);
  });

  it("cancels when the pointer moves into a scroll gesture", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress(onLongPress, { threshold: 400 }));

    act(() => result.current.onTouchStart(touchEvent()));
    act(() => result.current.onTouchMove(touchEvent(40, 30)));
    act(() => vi.advanceTimersByTime(500));

    expect(onLongPress).not.toHaveBeenCalled();
    expect(result.current.didFire()).toBe(false);
  });
});
