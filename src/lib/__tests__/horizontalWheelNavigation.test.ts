import { describe, expect, it, vi } from "vitest";
import {
  canElementScrollHorizontally,
  createHorizontalWheelPageTurner,
} from "../horizontalWheelNavigation";

describe("createHorizontalWheelPageTurner", () => {
  it("turns pages when horizontal wheel delta crosses threshold", () => {
    let time = 1000;
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const handler = createHorizontalWheelPageTurner({
      onPrev,
      onNext,
      threshold: 50,
      cooldownMs: 250,
      now: () => time,
    });

    const rightWheel = new WheelEvent("wheel", { deltaX: 100, deltaY: 0, cancelable: true });
    handler(rightWheel);
    expect(rightWheel.defaultPrevented).toBe(true);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();

    // Ignored during cooldown
    time += 100;
    handler(new WheelEvent("wheel", { deltaX: 100, deltaY: 0, cancelable: true }));
    expect(onNext).toHaveBeenCalledTimes(1);

    // Works again after cooldown
    time += 200;
    handler(new WheelEvent("wheel", { deltaX: -100, deltaY: 0, cancelable: true }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("accumulates small horizontal deltas and resets on direction change", () => {
    let time = 1000;
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const handler = createHorizontalWheelPageTurner({
      onPrev,
      onNext,
      threshold: 50,
      cooldownMs: 250,
      now: () => time,
    });

    handler(new WheelEvent("wheel", { deltaX: 30, deltaY: 0, cancelable: true }));
    expect(onNext).not.toHaveBeenCalled();

    // Reversing direction resets accumulator
    handler(new WheelEvent("wheel", { deltaX: -25, deltaY: 0, cancelable: true }));
    expect(onPrev).not.toHaveBeenCalled();

    handler(new WheelEvent("wheel", { deltaX: -30, deltaY: 0, cancelable: true }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("ignores vertical wheel and modifier-held wheel events", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const handler = createHorizontalWheelPageTurner({ onPrev, onNext });

    const vertical = new WheelEvent("wheel", { deltaX: 10, deltaY: 100, cancelable: true });
    handler(vertical);
    expect(vertical.defaultPrevented).toBe(false);

    const ctrlWheel = new WheelEvent("wheel", { deltaX: 100, deltaY: 0, ctrlKey: true, cancelable: true });
    handler(ctrlWheel);
    expect(ctrlWheel.defaultPrevented).toBe(false);

    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("yields to native horizontal scrolling when canConsumeNativeScroll returns true", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const handler = createHorizontalWheelPageTurner({
      onPrev,
      onNext,
      canConsumeNativeScroll: () => true,
    });

    const wheel = new WheelEvent("wheel", { deltaX: 120, deltaY: 0, cancelable: true });
    handler(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe("canElementScrollHorizontally", () => {
  it("detects horizontal scroll room at boundary container", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollWidth", { value: 1000, configurable: true });
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "scrollLeft", { value: 0, writable: true, configurable: true });

    expect(canElementScrollHorizontally(container, 50, container)).toBe(true);
    expect(canElementScrollHorizontally(container, -50, container)).toBe(false);

    container.scrollLeft = 600;
    expect(canElementScrollHorizontally(container, 50, container)).toBe(false);
    expect(canElementScrollHorizontally(container, -50, container)).toBe(true);
  });
});
