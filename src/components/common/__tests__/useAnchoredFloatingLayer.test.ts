import { describe, expect, it } from "vitest";
import { computeFloatingLayerBounds } from "../useAnchoredFloatingLayer";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe("computeFloatingLayerBounds", () => {
  it("places the layer above the anchor when there is room", () => {
    const bounds = computeFloatingLayerBounds({
      anchor: rect(100, 500, 300, 40),
      viewport: { width: 1200, height: 800 },
    });
    expect(bounds.placement).toBe("above");
    expect(bounds.left).toBe(100);
    expect(bounds.width).toBe(300);
    expect(bounds.maxHeight).toBe(320);
    expect(bounds.bottom).toBe(308);
  });

  it("flips below when the space above is too small", () => {
    const bounds = computeFloatingLayerBounds({
      anchor: rect(100, 100, 300, 40),
      viewport: { width: 1200, height: 800 },
    });
    expect(bounds.placement).toBe("below");
    expect(bounds.top).toBe(148);
    expect(bounds.maxHeight).toBe(320);
  });

  it("clamps the width and left edge to the host panel", () => {
    const bounds = computeFloatingLayerBounds({
      anchor: rect(200, 500, 380, 40),
      host: rect(0, 0, 300, 800),
      viewport: { width: 1200, height: 800 },
    });
    expect(bounds.left).toBe(8);
    expect(bounds.width).toBe(284);
  });

  it("keeps a wide anchor inside the viewport", () => {
    const bounds = computeFloatingLayerBounds({
      anchor: rect(900, 500, 380, 40),
      viewport: { width: 1000, height: 800 },
    });
    expect(bounds.left).toBe(612);
    expect(bounds.width).toBe(380);
  });

  it("never exceeds the preferred height or the available space", () => {
    const bounds = computeFloatingLayerBounds({
      anchor: rect(100, 200, 300, 40),
      viewport: { width: 1200, height: 800 },
      preferredMaxHeight: 260,
    });
    expect(bounds.placement).toBe("above");
    expect(bounds.maxHeight).toBe(184);
  });

  it("uses the anchor width when it is narrower than the floor", () => {
    const bounds = computeFloatingLayerBounds({
      anchor: rect(100, 500, 200, 40),
      viewport: { width: 1200, height: 800 },
    });
    expect(bounds.width).toBe(280);
  });
});
