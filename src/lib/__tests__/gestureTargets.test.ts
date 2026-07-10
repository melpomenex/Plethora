import { describe, expect, it } from "vitest";
import { shouldIgnoreGlobalGesture } from "../gestureTargets";

describe("shouldIgnoreGlobalGesture", () => {
  it("protects interactive and feature-owned gesture surfaces", () => {
    const button = document.createElement("button");
    const scroller = document.createElement("div");
    scroller.dataset.horizontalScroll = "true";
    const viewer = document.createElement("div");
    viewer.className = "pdf-viewer";

    expect(shouldIgnoreGlobalGesture(button)).toBe(true);
    expect(shouldIgnoreGlobalGesture(scroller)).toBe(true);
    expect(shouldIgnoreGlobalGesture(viewer)).toBe(true);
  });

  it("allows gestures that begin on neutral application chrome", () => {
    expect(shouldIgnoreGlobalGesture(document.createElement("div"))).toBe(false);
    expect(shouldIgnoreGlobalGesture(null)).toBe(false);
  });
});

