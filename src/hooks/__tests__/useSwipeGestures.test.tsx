/**
 * Unit tests for the swipe gesture lifecycle (`src/hooks/useSwipeGestures.ts`).
 *
 * The regression these exist for: the snap-back animation used to cancel
 * itself. Its `setState` rebuilt the handlers, which re-ran the listener-binding
 * effect, whose cleanup called `cancelAnimationFrame` on the very frame the
 * animation had just scheduled. A row released after a drag froze at the full
 * drag offset — parked off-screen to the left with `isDragging` stuck true.
 *
 * A DOM-level test is the only honest way to catch that: the bug lives in the
 * interaction between the animation, React's commit, and the effect cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useState } from "react";

vi.mock("../../utils/soundService", () => ({
  supportsHaptics: () => false,
}));

import { useSwipeGestures, type SwipeActions, type SwipeGestureOptions } from "../useSwipeGestures";

/**
 * Renders the hook against a real element, the way SwipeableItem does, so the
 * ref is attached during commit and the listener-binding effect sees it.
 */
function renderSwipe(actions: SwipeActions = {}, options: SwipeGestureOptions = {}) {
  const latest = { current: null as ReturnType<typeof useSwipeGestures> | null };
  const observed: number[] = [];

  function Harness() {
    const gesture = useSwipeGestures(actions, options);
    latest.current = gesture;
    observed.push(gesture.state.offsetX);
    return <div data-testid="row" ref={gesture.elementRef} />;
  }

  const utils = render(<Harness />);
  const el = utils.getByTestId("row") as HTMLDivElement;

  const host = {
    el,
    touch(type: "touchstart" | "touchmove" | "touchend" | "touchcancel", x: number, y = 0) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }],
      });
      el.dispatchEvent(event);
    },
  };

  const state = () => latest.current!.state;
  return { host, state, gesture: () => latest.current!, observed };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useSwipeGestures — drag", () => {
  it("tracks the first move of a gesture", () => {
    const { host, state } = renderSwipe({}, { threshold: 80 });

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 200);
    });

    // The old hook dropped this move: handleTouchMove still closed over
    // isDragging === false from before touchstart.
    expect(state().offsetX).toBe(-100);
    expect(state().isDragging).toBe(true);
    expect(state().direction).toBe("left");
  });

  it("clamps the live offset so a flick cannot push the row off-screen", () => {
    const { host, state } = renderSwipe({}, { maxOffset: 100 });

    act(() => {
      host.touch("touchstart", 350);
      host.touch("touchmove", 40); // 310px of travel
    });

    expect(state().offsetX).toBe(-100);
  });

  it("clamps vertically too", () => {
    const { host, state } = renderSwipe({}, { maxOffset: 50 });

    act(() => {
      host.touch("touchstart", 200, 400);
      host.touch("touchmove", 200, 40);
    });

    expect(state().offsetY).toBe(-50);
  });
});

describe("useSwipeGestures — snap-back is not cancelled by its own state update", () => {
  it("animates the row all the way back to zero", () => {
    const { host, state } = renderSwipe({}, { threshold: 80 });

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 200);
    });
    expect(state().offsetX).toBe(-100);

    // Release slowly enough that no action fires — otherwise the row snaps to
    // rest immediately and the snap-back never runs at all.
    act(() => {
      vi.advanceTimersByTime(2000);
      host.touch("touchend", 200);
    });
    act(() => { vi.advanceTimersByTime(50); });
    // Mid-flight: it moved, but has not jumped to zero or frozen at -100.
    expect(Math.abs(state().offsetX)).toBeLessThan(100);

    act(() => { vi.advanceTimersByTime(400); });
    // The regression: this used to stay at -100 forever.
    expect(state().offsetX).toBe(0);
    expect(state().offsetY).toBe(0);
    expect(state().isDragging).toBe(false);
  });

  it("approaches zero progressively rather than jumping or stalling", () => {
    // The regression, stated behaviourally: the old hook's snap-back scheduled
    // one rAF, and the React commit it triggered re-ran the binding effect,
    // whose cleanup cancelled that very rAF — so the row stalled at -150.
    // Sampling the offset over the animation shows a curve, not a plateau.
    const { host, state } = renderSwipe({}, { threshold: 80 });

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 150);
      vi.advanceTimersByTime(2000); // below velocityThreshold: no action
      host.touch("touchend", 150);
    });

    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      act(() => { vi.advanceTimersByTime(50); });
      samples.push(state().offsetX);
    }

    // Every sample is closer to rest than the one before, i.e. the animation
    // actually ran each frame instead of stalling at the -150 drag offset.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    // ...and it comes fully to rest rather than creeping forever.
    act(() => { vi.advanceTimersByTime(100); });
    expect(state().offsetX).toBe(0);
    expect(state().isDragging).toBe(false);
  });

  it("returns the row to rest on a cancelled touch", () => {
    const { host, state } = renderSwipe({});

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 200);
      vi.advanceTimersByTime(2000);
      host.touch("touchcancel", 200);
    });
    act(() => { vi.advanceTimersByTime(400); });

    expect(state().offsetX).toBe(0);
    expect(state().isDragging).toBe(false);
  });
});

describe("useSwipeGestures — actions", () => {
  it("triggers the left action and returns to rest immediately", () => {
    const onSwipeLeft = vi.fn();
    const { host, state } = renderSwipe({ onSwipeLeft }, { threshold: 80 });

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 150);
    });
    act(() => {
      vi.advanceTimersByTime(50);
      host.touch("touchend", 150);
    });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(state().offsetX).toBe(0);
  });

  it("does not trigger an action when the drag is too slow", () => {
    const onSwipeLeft = vi.fn();
    const { host, state } = renderSwipe({ onSwipeLeft }, { threshold: 80 });

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 150);
      vi.advanceTimersByTime(2000); // very slow
      host.touch("touchend", 150);
    });
    act(() => { vi.advanceTimersByTime(400); });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(state().offsetX).toBe(0);
  });

  it("picks up the latest action callbacks without rebinding listeners", () => {
    // SwipeableItem rebuilds its action object on every render. The handlers
    // must see the new callbacks; if they closed over `actions`, this swipe
    // would still call the first one.
    // Held in a box: a bare function passed to useState is treated as a lazy
    // initializer (and to setState as an updater), which would have React call
    // the mock itself.
    const first = { fn: vi.fn() };
    const second = { fn: vi.fn() };
    let swap: () => void = () => {};

    function Harness() {
      const [handler, setHandler] = useState(first);
      swap = () => setHandler(second);
      const gesture = useSwipeGestures({ onSwipeLeft: handler.fn }, { threshold: 80 });
      return <div data-testid="row" ref={gesture.elementRef} />;
    }

    const utils = render(<Harness />);
    const el = utils.getByTestId("row") as HTMLDivElement;
    const touch = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: type === "touchend" ? [] : [{ clientX: x, clientY: 0 }],
      });
      el.dispatchEvent(event);
    };

    act(() => { swap(); });

    act(() => {
      touch("touchstart", 300);
      touch("touchmove", 150);
    });
    act(() => {
      vi.advanceTimersByTime(50);
      touch("touchend", 150);
    });

    expect(first.fn).not.toHaveBeenCalled();
    expect(second.fn).toHaveBeenCalledTimes(1);
  });
});

describe("useSwipeGestures — reset", () => {
  it("returns a displaced row to rest", () => {
    const { host, state, gesture } = renderSwipe({});

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 200);
    });
    expect(state().offsetX).toBe(-100);

    act(() => { gesture().reset(); });
    expect(state().offsetX).toBe(0);
    expect(state().isDragging).toBe(false);
  });
});

describe("useSwipeGestures — disabled", () => {
  it("ignores touch entirely while disabled", () => {
    const onSwipeLeft = vi.fn();
    const { host, state } = renderSwipe({ onSwipeLeft }, { disabled: true });

    act(() => {
      host.touch("touchstart", 300);
      host.touch("touchmove", 150);
      vi.advanceTimersByTime(50);
      host.touch("touchend", 150);
    });

    expect(state().offsetX).toBe(0);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });
});
