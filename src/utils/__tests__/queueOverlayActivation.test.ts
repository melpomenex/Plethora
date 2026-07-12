import { describe, expect, it } from "vitest";
import {
  STATIONARY_TAP_TOLERANCE_PX,
  hasActiveTextSelection,
  isEligibleOverlayTapTarget,
  isStationaryTap,
} from "../queueOverlayActivation";

describe("queue overlay activation", () => {
  it("accepts a stationary tap and minor finger jitter", () => {
    expect(isStationaryTap({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(true);
    expect(isStationaryTap(
      { x: 10, y: 20 },
      { x: 10 + STATIONARY_TAP_TOLERANCE_PX - 1, y: 20 },
    )).toBe(true);
  });

  it("rejects scrolling, swiping, and cancelled gestures", () => {
    expect(isStationaryTap({ x: 0, y: 0 }, { x: 0, y: 80 })).toBe(false);
    expect(isStationaryTap({ x: 0, y: 0 }, { x: 80, y: 0 })).toBe(false);
    expect(isStationaryTap({ x: 0, y: 0 }, { x: 0, y: 0 }, true)).toBe(false);
  });

  it("allows reading content but excludes interactive targets", () => {
    const readingContent = document.createElement("p");
    const button = document.createElement("button");
    const nestedIcon = document.createElement("span");
    button.appendChild(nestedIcon);

    expect(isEligibleOverlayTapTarget(readingContent)).toBe(true);
    expect(isEligibleOverlayTapTarget(button)).toBe(false);
    expect(isEligibleOverlayTapTarget(nestedIcon)).toBe(false);
  });

  it("excludes gestures while text remains selected", () => {
    expect(hasActiveTextSelection({
      isCollapsed: false,
      toString: () => "selected passage",
    } as Selection)).toBe(true);
    expect(hasActiveTextSelection({
      isCollapsed: true,
      toString: () => "",
    } as Selection)).toBe(false);
  });
});
