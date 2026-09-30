/**
 * Integration test for the swipeable queue row (`SwipeableItem`).
 *
 * The reported symptom was a row resting off-screen to the left. The root
 * cause lived in the gesture hook, but the guarantee that matters is about this
 * component's rendered transform: after any completed or interrupted gesture,
 * the row must come fully back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type React from "react";

vi.mock("../../utils/soundService", () => ({
  supportsHaptics: () => false,
}));

import { SwipeableItem } from "../SwipeableItem";

function touch(el: Element, type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: 0 }],
  });
  el.dispatchEvent(event);
}

/** The inner content div carries the transform. */
function contentOf(container: HTMLElement): HTMLElement {
  return container.querySelector(".relative.z-10") as HTMLElement;
}

function translateXOf(el: HTMLElement): number {
  const match = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform || "");
  return match ? Number(match[1]) : 0;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SwipeableItem — row stays in view", () => {
  it("returns the row to zero after a released drag", () => {
    const onSwipeLeft = vi.fn();
    const { container } = render(
      <SwipeableItem onSwipeLeft={onSwipeLeft}>
        <span>row</span>
      </SwipeableItem>
    );
    const host = container.firstElementChild as HTMLElement;

    act(() => {
      touch(host, "touchstart", 320);
      touch(host, "touchmove", 200);
    });
    expect(translateXOf(contentOf(container))).toBeLessThan(0);

    act(() => {
      vi.advanceTimersByTime(2000); // slow release: below the velocity threshold
      touch(host, "touchend", 200);
    });
    act(() => { vi.advanceTimersByTime(500); });

    // Not stranded part-way off-screen.
    expect(translateXOf(contentOf(container))).toBe(0);
  });

  it("never drags the row past the reveal width", () => {
    const { container } = render(
      <SwipeableItem onSwipeLeft={vi.fn()}>
        <span>row</span>
      </SwipeableItem>
    );
    const host = container.firstElementChild as HTMLElement;

    act(() => {
      touch(host, "touchstart", 350);
      touch(host, "touchmove", 20); // 330px of travel
    });

    // Bounded, so a fast flick cannot paint the row off-screen mid-drag.
    expect(translateXOf(contentOf(container))).toBe(-160);
  });

  it("returns the row to zero when the touch is cancelled", () => {
    const { container } = render(
      <SwipeableItem onSwipeLeft={vi.fn()}>
        <span>row</span>
      </SwipeableItem>
    );
    const host = container.firstElementChild as HTMLElement;

    act(() => {
      touch(host, "touchstart", 320);
      touch(host, "touchmove", 200);
      vi.advanceTimersByTime(2000);
      touch(host, "touchcancel", 200);
    });
    act(() => { vi.advanceTimersByTime(500); });

    expect(translateXOf(contentOf(container))).toBe(0);
  });

  it("still fires the swipe action and returns to rest", () => {
    const onSwipeLeft = vi.fn();
    const onSwipeComplete = vi.fn();
    const { container } = render(
      <SwipeableItem onSwipeLeft={onSwipeLeft} onSwipeComplete={onSwipeComplete}>
        <span>row</span>
      </SwipeableItem>
    );
    const host = container.firstElementChild as HTMLElement;

    act(() => {
      touch(host, "touchstart", 320);
      touch(host, "touchmove", 180);
    });
    act(() => {
      vi.advanceTimersByTime(50);
      touch(host, "touchend", 180);
    });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeComplete).toHaveBeenCalledWith("left");
    expect(translateXOf(contentOf(container))).toBe(0);
  });

  it("does not fire an action while disabled", () => {
    const onSwipeLeft = vi.fn();
    const { container } = render(
      <SwipeableItem onSwipeLeft={onSwipeLeft} disabled>
        <span>row</span>
      </SwipeableItem>
    );
    const host = container.firstElementChild as HTMLElement;

    act(() => {
      touch(host, "touchstart", 320);
      touch(host, "touchmove", 180);
    });
    act(() => {
      vi.advanceTimersByTime(50);
      touch(host, "touchend", 180);
    });
    act(() => { vi.advanceTimersByTime(500); });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(translateXOf(contentOf(container))).toBe(0);
  });
});
