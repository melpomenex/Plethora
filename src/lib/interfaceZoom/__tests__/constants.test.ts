import { describe, expect, it } from "vitest";
import {
  INTERFACE_ZOOM_DEFAULT,
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  INTERFACE_ZOOM_STEP,
  interfaceZoomToScale,
  normalizeInterfaceZoom,
  stepInterfaceZoom,
} from "../constants";

describe("interface zoom constants", () => {
  it("exposes the documented range and step", () => {
    expect(INTERFACE_ZOOM_DEFAULT).toBe(100);
    expect(INTERFACE_ZOOM_MIN).toBe(70);
    expect(INTERFACE_ZOOM_MAX).toBe(150);
    expect(INTERFACE_ZOOM_STEP).toBe(10);
  });
});

describe("normalizeInterfaceZoom", () => {
  it.each([
    [69, 70],
    [74, 70],
    [76, 80],
    [149, 150],
    [151, 150],
    [125, 130],
    [70, 70],
    [100, 100],
    [150, 150],
    [0, 70],
    [-100, 70],
    [1_000, 150],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeInterfaceZoom(input)).toBe(expected);
  });

  it("falls back to the default for non-numeric and non-finite values", () => {
    expect(normalizeInterfaceZoom(Number.NaN)).toBe(INTERFACE_ZOOM_DEFAULT);
    expect(normalizeInterfaceZoom(Number.POSITIVE_INFINITY)).toBe(INTERFACE_ZOOM_DEFAULT);
    expect(normalizeInterfaceZoom(undefined)).toBe(INTERFACE_ZOOM_DEFAULT);
    expect(normalizeInterfaceZoom(null)).toBe(INTERFACE_ZOOM_DEFAULT);
    expect(normalizeInterfaceZoom("120")).toBe(INTERFACE_ZOOM_DEFAULT);
    expect(normalizeInterfaceZoom({})).toBe(INTERFACE_ZOOM_DEFAULT);
  });
});

describe("stepInterfaceZoom", () => {
  it("steps by exactly ten points from every supported value", () => {
    for (let value = INTERFACE_ZOOM_MIN; value <= INTERFACE_ZOOM_MAX; value += INTERFACE_ZOOM_STEP) {
      const expectedIn = Math.min(INTERFACE_ZOOM_MAX, value + INTERFACE_ZOOM_STEP);
      const expectedOut = Math.max(INTERFACE_ZOOM_MIN, value - INTERFACE_ZOOM_STEP);
      expect(stepInterfaceZoom(value, "in")).toBe(expectedIn);
      expect(stepInterfaceZoom(value, "out")).toBe(expectedOut);
    }
  });

  it("clamps at both bounds", () => {
    expect(stepInterfaceZoom(150, "in")).toBe(150);
    expect(stepInterfaceZoom(70, "out")).toBe(70);
  });

  it("normalizes the starting value before stepping", () => {
    expect(stepInterfaceZoom(125, "in")).toBe(140);
    expect(stepInterfaceZoom(125, "out")).toBe(120);
    expect(stepInterfaceZoom(Number.NaN, "out")).toBe(90);
  });
});

describe("interfaceZoomToScale", () => {
  it("converts a percentage into a native scale factor", () => {
    expect(interfaceZoomToScale(80)).toBe(0.8);
    expect(interfaceZoomToScale(100)).toBe(1);
    expect(interfaceZoomToScale(130)).toBe(1.3);
    expect(interfaceZoomToScale(150)).toBe(1.5);
  });
});
