import { describe, expect, it } from "vitest";
import {
  createScrollDismissGate,
  isSuppressedSelection,
  SCROLL_DISMISS_THRESHOLD_PX,
} from "../touchSelectionDismissal";

describe("createScrollDismissGate (scroll dismisses the touch selection sheet)", () => {
  it("does not dismiss below the jitter threshold", () => {
    const gate = createScrollDismissGate();
    const scroller = new EventTarget();
    expect(gate.track(scroller, 0, 0)).toBe(false); // gesture origin
    expect(gate.track(scroller, 4, 0)).toBe(false); // 4px < 8px threshold
    expect(gate.track(scroller, 7, 0)).toBe(false);
  });

  it("dismisses once travel crosses the threshold, then re-arms", () => {
    const gate = createScrollDismissGate();
    const scroller = new EventTarget();
    expect(gate.track(scroller, 100, 0)).toBe(false); // origin
    expect(gate.track(scroller, 108, 0)).toBe(true); // +8px → dismiss
    // Momentum events after the dismissal re-arm a fresh gesture, not more dismissals.
    expect(gate.track(scroller, 130, 0)).toBe(false);
    expect(gate.track(scroller, 150, 0)).toBe(true); // next deliberate gesture
  });

  it("counts horizontal travel against the same threshold", () => {
    const gate = createScrollDismissGate();
    const scroller = new EventTarget();
    expect(gate.track(scroller, 0, 50)).toBe(false);
    expect(gate.track(scroller, 3, 58)).toBe(true); // 3 + 8 combined travel
  });

  it("re-arms per scroller so interleaved overlay scrolls cannot accumulate phantom travel", () => {
    const gate = createScrollDismissGate();
    const content = new EventTarget();
    const overlay = new EventTarget();
    expect(gate.track(content, 0, 0)).toBe(false);
    expect(gate.track(overlay, 500, 0)).toBe(false); // sheet's own scroller: new origin
    expect(gate.track(content, 5, 0)).toBe(false); // still the same 5px content gesture
    expect(gate.track(content, 14, 0)).toBe(true); // only now deliberate (9px from re-arm)
  });

  it("reset() drops the in-flight gesture", () => {
    const gate = createScrollDismissGate();
    const scroller = new EventTarget();
    expect(gate.track(scroller, 0, 0)).toBe(false);
    gate.reset();
    expect(gate.track(scroller, 40, 0)).toBe(false); // new origin, not a dismissal
  });

  it("uses the shared 8px threshold by default", () => {
    expect(SCROLL_DISMISS_THRESHOLD_PX).toBe(8);
  });
});

describe("isSuppressedSelection (dismissed selection cannot re-open the sheet)", () => {
  it("suppresses the same text regardless of offset churn from reflow DOM mutations", () => {
    // The old guard keyed on `${length}:${anchor}:${focus}` — appending lazy
    // reflow sections shifted the offsets and defeated it on every scroll.
    expect(isSuppressedSelection("the same passage", "the same passage")).toBe(true);
  });

  it("lets genuinely different text through", () => {
    expect(isSuppressedSelection("the same passage", "a different passage")).toBe(false);
  });

  it("a fresh gesture (guard cleared) re-enables the same text", () => {
    expect(isSuppressedSelection(null, "the same passage")).toBe(false);
  });

  it("an empty dismissal never suppresses", () => {
    expect(isSuppressedSelection("", "")).toBe(false);
  });
});
