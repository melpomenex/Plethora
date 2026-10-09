import { describe, expect, it, vi } from "vitest";
import { createNavigationCompletion, createNavigationFeedback } from "../navigationFeedback";

describe("navigation feedback", () => {
  it("vibrates once only when legacy feedback opt-in and haptics are available", () => {
    const vibrate = vi.fn(() => true);
    let enabled = false;
    const emit = createNavigationFeedback({
      isEnabled: () => enabled,
      isSupported: () => true,
      vibrate,
    });

    expect(emit("back-1")).toBe(false);
    enabled = true;
    expect(emit("back-1")).toBe(false);
    expect(emit("back-2")).toBe(true);
    expect(emit("back-2")).toBe(false);
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it("silently skips unsupported and rejected vibration delivery", () => {
    const vibrate = vi.fn(() => false);
    const unsupported = createNavigationFeedback({
      isEnabled: () => true,
      isSupported: () => false,
      vibrate,
    });
    const rejected = createNavigationFeedback({
      isEnabled: () => true,
      isSupported: () => true,
      vibrate,
    });

    expect(unsupported("back-1")).toBe(false);
    expect(rejected("back-2")).toBe(false);
    expect(vibrate).toHaveBeenCalledOnce();

    const throwing = createNavigationFeedback({
      isEnabled: () => true,
      isSupported: () => true,
      vibrate: () => { throw new Error("delivery rejected"); },
    });
    expect(throwing("back-3")).toBe(false);
  });

  it("defers feedback until a guarded action completes and supports silent cancellation", () => {
    const emit = vi.fn(() => true);
    const confirmed = createNavigationCompletion("confirmed", emit);
    confirmed.defer();
    expect(confirmed.isDeferred()).toBe(true);
    expect(emit).not.toHaveBeenCalled();
    confirmed.complete();
    confirmed.complete();
    expect(emit).toHaveBeenCalledOnce();

    const cancelled = createNavigationCompletion("cancelled", emit);
    cancelled.defer();
    cancelled.suppress();
    cancelled.complete();
    expect(emit).toHaveBeenCalledOnce();

    const brokenAdapterCompletion = createNavigationCompletion("broken", () => { throw new Error("adapter failure"); });
    expect(() => brokenAdapterCompletion.complete()).not.toThrow();
  });
});
