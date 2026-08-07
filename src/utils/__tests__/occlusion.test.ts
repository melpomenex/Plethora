import { describe, expect, it } from "vitest";
import { clampPercent, clampRegion, clampRegions, regionHasUsableArea } from "../occlusion";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";

describe("occlusion region clamping", () => {
  it("clamps percentages into the 0–100 range", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("clamps a region that overflows the right or bottom edge", () => {
    const region = clampRegion({ x: 80, y: 10, width: 50, height: 40 });
    expect(region).toMatchObject({ x: 80, y: 10, width: 20, height: 40 });
  });

  it("clamps a region that starts outside the image", () => {
    const region = clampRegion({ x: -20, y: -10, width: 30, height: 20 });
    expect(region).toMatchObject({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("preserves identity fields while clamping", () => {
    const region = clampRegion({ id: "r1", x: 5, y: 5, width: 200, height: 200, label: "label", color: "#f00" });
    expect(region.id).toBe("r1");
    expect(region.label).toBe("label");
    expect(region.color).toBe("#f00");
    expect(region).toMatchObject({ x: 5, y: 5, width: 95, height: 95 });
  });

  it("drops regions that collapse to zero size after clamping", () => {
    const regions = clampRegions([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 110, y: 0, width: 10, height: 10 },
      { x: 0, y: 110, width: 10, height: 10 },
    ]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("clips regions that straddle the edge instead of shifting them", () => {
    const regions = clampRegions([
      { x: -20, y: -10, width: 30, height: 20 },
      { x: 95, y: 0, width: 20, height: 10 },
      { x: 0, y: 95, width: 10, height: 20 },
    ]);
    expect(regions).toHaveLength(3);
    expect(regions[0]).toMatchObject({ x: 0, y: 0, width: 10, height: 10 });
    expect(regions[1]).toMatchObject({ x: 95, y: 0, width: 5, height: 10 });
    expect(regions[2]).toMatchObject({ x: 0, y: 95, width: 10, height: 5 });
  });

  it("keeps non-finite values out of saved regions", () => {
    const regions = clampRegions([
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: Number.NaN, height: 10 },
    ]);
    expect(regions).toHaveLength(0);
  });

  it("regionHasUsableArea rejects out-of-bounds and zero-size regions", () => {
    const usable: ImageOcclusionRegion = { x: 10, y: 10, width: 10, height: 10 };
    expect(regionHasUsableArea(usable)).toBe(true);
    expect(regionHasUsableArea({ x: 95, y: 0, width: 20, height: 10 })).toBe(false);
    expect(regionHasUsableArea({ x: 0, y: 0, width: 0, height: 10 })).toBe(false);
    expect(regionHasUsableArea({ x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });
});
