import { describe, expect, it } from "vitest";
import {
  clampPercent,
  clampRegion,
  clampRegions,
  computeVisibleOcclusionOverlays,
  evaluateCardOcclusion,
  expandRegionsToCards,
  isDuplicateRegion,
  isOcclusionCard,
  normalizeAndValidateOcclusionRegions,
  percentToViewport,
  regionHasUsableArea,
  regionIoU,
  viewportToPercent,
  zoomViewportAt,
} from "../occlusion";
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

describe("occlusion viewport math", () => {
  const imgBounds = { offsetX: 40, offsetY: 20, width: 800, height: 600 };

  it("maps percent coordinates into screen space at fit-to-view", () => {
    const point = percentToViewport({ x: 0, y: 0 }, { scale: 1, panX: 0, panY: 0 }, imgBounds);
    expect(point).toEqual({ x: 40, y: 20 });
    const center = percentToViewport({ x: 50, y: 50 }, { scale: 1, panX: 0, panY: 0 }, imgBounds);
    expect(center).toEqual({ x: 440, y: 320 });
  });

  it("applies scale and pan when mapping percent to screen", () => {
    const viewport = { scale: 4, panX: 120, panY: -60 };
    const point = percentToViewport({ x: 10, y: 25 }, viewport, imgBounds);
    expect(point.x).toBeCloseTo((40 + 0.1 * 800) * 4 + 120);
    expect(point.y).toBeCloseTo((20 + 0.25 * 600) * 4 - 60);
  });

  it("round-trips percent -> screen -> percent at several scales and pans", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 12.5, y: 87.5 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
    ];
    const viewports = [
      { scale: 1, panX: 0, panY: 0 },
      { scale: 2, panX: 33, panY: -17 },
      { scale: 4, panX: -250, panY: 180 },
      { scale: 8, panX: 1000, panY: -900 },
    ];
    for (const viewport of viewports) {
      for (const point of points) {
        const screen = percentToViewport(point, viewport, imgBounds);
        const back = viewportToPercent(screen, viewport, imgBounds);
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
    }
  });

  it("clamps viewportToPercent results to the image bounds", () => {
    const viewport = { scale: 1, panX: 0, panY: 0 };
    const left = viewportToPercent({ x: -5000, y: -5000 }, viewport, imgBounds);
    expect(left).toEqual({ x: 0, y: 0 });
    const right = viewportToPercent({ x: 50000, y: 50000 }, viewport, imgBounds);
    expect(right).toEqual({ x: 100, y: 100 });
  });

  it("treats non-positive scale as fit-to-view rather than dividing by zero", () => {
    const viewport = { scale: 0, panX: 0, panY: 0 };
    const back = viewportToPercent(percentToViewport({ x: 25, y: 75 }, { scale: 1, panX: 0, panY: 0 }, imgBounds), viewport, imgBounds);
    expect(back.x).toBeCloseTo(25, 9);
    expect(back.y).toBeCloseTo(75, 9);
  });
});

describe("zoomViewportAt", () => {
  const imgBounds = { offsetX: 0, offsetY: 0, width: 1000, height: 1000 };

  it("keeps the anchor's image location fixed while zooming in", () => {
    const viewport = { scale: 1, panX: 0, panY: 0 };
    const anchor = { x: 300, y: 400 };
    const zoomed = zoomViewportAt(viewport, anchor, 2);
    expect(zoomed.scale).toBe(2);
    // The point under the anchor must map back to the same percent location.
    const before = viewportToPercent(anchor, viewport, imgBounds);
    const after = viewportToPercent(anchor, zoomed, imgBounds);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("clamps zoom to the 100%–800% range", () => {
    const base = { scale: 1, panX: 0, panY: 0 };
    expect(zoomViewportAt(base, { x: 0, y: 0 }, 0.1).scale).toBe(1);
    expect(zoomViewportAt(base, { x: 0, y: 0 }, 100).scale).toBe(8);
    const atMax = zoomViewportAt({ scale: 8, panX: 0, panY: 0 }, { x: 0, y: 0 }, 2);
    expect(atMax.scale).toBe(8);
  });

  it("zooming out respects pan and keeps the anchor fixed", () => {
    const viewport = { scale: 4, panX: 120, panY: -80 };
    const anchor = { x: 500, y: 300 };
    const zoomed = zoomViewportAt(viewport, anchor, 0.5);
    expect(zoomed.scale).toBe(2);
    const before = viewportToPercent(anchor, viewport, imgBounds);
    const after = viewportToPercent(anchor, zoomed, imgBounds);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe("expandRegionsToCards", () => {
  const a: ImageOcclusionRegion = { id: "a", x: 0, y: 0, width: 10, height: 10, label: "hippocampus" };
  const b: ImageOcclusionRegion = { id: "b", x: 20, y: 20, width: 10, height: 10, label: "amygdala" };
  const c: ImageOcclusionRegion = { id: "c", x: 40, y: 40, width: 10, height: 10 };

  it("produces one card per region in hide-one mode with only target hidden and siblings visible", () => {
    const cards = expandRegionsToCards([a, b, c], "hide-one");
    expect(cards).toHaveLength(3);
    expect(cards[0].targetRegionId).toBe("a");
    expect(cards[0].hiddenRegions).toEqual([a]);
    expect(cards[0].visibleRegions).toEqual([b, c]);
    expect(cards[0].answer).toBe("hippocampus");

    expect(cards[1].targetRegionId).toBe("b");
    expect(cards[1].hiddenRegions).toEqual([b]);
    expect(cards[1].visibleRegions).toEqual([a, c]);
    expect(cards[1].answer).toBe("amygdala");

    expect(cards[2].targetRegionId).toBe("c");
    expect(cards[2].hiddenRegions).toEqual([c]);
    expect(cards[2].visibleRegions).toEqual([a, b]);
    expect(cards[2].answer).toBeUndefined();
  });

  it("produces one card per region in hide-all mode with all regions hidden and distinct targetRegionId", () => {
    const cards = expandRegionsToCards([a, b, c], "hide-all");
    expect(cards).toHaveLength(3);
    expect(cards[0].targetRegionId).toBe("a");
    expect(cards[0].hiddenRegions).toEqual([a, b, c]);
    expect(cards[0].visibleRegions).toEqual([]);
    expect(cards[0].answer).toBe("hippocampus");

    expect(cards[1].targetRegionId).toBe("b");
    expect(cards[1].hiddenRegions).toEqual([a, b, c]);
    expect(cards[1].visibleRegions).toEqual([]);
    expect(cards[1].answer).toBe("amygdala");

    expect(cards[2].targetRegionId).toBe("c");
    expect(cards[2].hiddenRegions).toEqual([a, b, c]);
    expect(cards[2].visibleRegions).toEqual([]);
    expect(cards[2].answer).toBeUndefined();
  });

  it("supports per-region as an alias for hide-one", () => {
    const cards = expandRegionsToCards([a, b], "per-region");
    expect(cards).toHaveLength(2);
    expect(cards[0].targetRegionId).toBe("a");
    expect(cards[0].hiddenRegions).toEqual([a]);
    expect(cards[0].visibleRegions).toEqual([b]);
  });

  it("prefers explicit answer over region label in both modes", () => {
    const hideAllCards = expandRegionsToCards([a, b], "hide-all", {
      answersByRegionId: { a: "explicit A" },
    });
    expect(hideAllCards[0].answer).toBe("explicit A");
    expect(hideAllCards[1].answer).toBe("amygdala");

    const hideOneCards = expandRegionsToCards([a, b], "hide-one", {
      answersByRegionId: { b: "explicit B" },
    });
    expect(hideOneCards[0].answer).toBe("hippocampus");
    expect(hideOneCards[1].answer).toBe("explicit B");
  });

  it("returns no cards when every region is unusable", () => {
    expect(expandRegionsToCards([{ x: 0, y: 0, width: 0, height: 0 }], "hide-one")).toEqual([]);
    expect(expandRegionsToCards([{ x: 110, y: 0, width: 10, height: 10 }], "hide-all")).toEqual([]);
    expect(expandRegionsToCards([], "hide-all")).toEqual([]);
  });

  it("excludes zero-area and out-of-bounds regions from card output", () => {
    const bad: ImageOcclusionRegion = { id: "bad", x: 95, y: 0, width: 20, height: 10 };
    const cards = expandRegionsToCards([a, bad], "hide-all");
    expect(cards).toHaveLength(1);
    expect(cards[0].targetRegionId).toBe("a");
    expect(cards[0].hiddenRegions).toEqual([a]);
  });
});

describe("region IoU and duplicate detection", () => {
  it("computes IoU for overlapping rectangles", () => {
    const a: ImageOcclusionRegion = { x: 0, y: 0, width: 10, height: 10 };
    const exact: ImageOcclusionRegion = { x: 0, y: 0, width: 10, height: 10 };
    expect(regionIoU(a, exact)).toBe(1);
    const half: ImageOcclusionRegion = { x: 5, y: 0, width: 10, height: 10 };
    expect(regionIoU(a, half)).toBeCloseTo(1 / 3);
  });

  it("returns 0 for disjoint rectangles", () => {
    const a: ImageOcclusionRegion = { x: 0, y: 0, width: 10, height: 10 };
    const far: ImageOcclusionRegion = { x: 90, y: 90, width: 10, height: 10 };
    expect(regionIoU(a, far)).toBe(0);
  });

  it("returns 0 for zero-area rectangles", () => {
    const a: ImageOcclusionRegion = { x: 0, y: 0, width: 10, height: 10 };
    const empty: ImageOcclusionRegion = { x: 0, y: 0, width: 0, height: 0 };
    expect(regionIoU(a, empty)).toBe(0);
  });

  it("flags candidates above the IoU threshold as duplicates", () => {
    const existing: ImageOcclusionRegion = { x: 0, y: 0, width: 10, height: 10 };
    expect(isDuplicateRegion({ x: 1, y: 1, width: 9, height: 9 }, [existing])).toBe(true);
    expect(isDuplicateRegion({ x: 50, y: 50, width: 10, height: 10 }, [existing])).toBe(false);
  });

  it("respects a custom threshold", () => {
    const existing: ImageOcclusionRegion = { x: 0, y: 0, width: 10, height: 10 };
    // IoU of a and half-overlap is 1/3: duplicate only under a lower threshold.
    expect(isDuplicateRegion({ x: 5, y: 0, width: 10, height: 10 }, [existing], 0.2)).toBe(true);
    expect(isDuplicateRegion({ x: 5, y: 0, width: 10, height: 10 }, [existing], 0.5)).toBe(false);
  });
});

describe("evaluateCardOcclusion & metadata-driven occlusion detection", () => {
  it("detects occlusion via interaction_metadata even when item_type is Qa or Flashcard", () => {
    const qaOcclusion = {
      id: "qa-occ-1",
      item_type: "Qa",
      question: "Identify the highlighted lobe",
      answer: "Occipital lobe",
      image_asset_ids: ["asset-brain"],
      interaction_metadata: {
        imageOcclusionRegions: [{ id: "r1", x: 0.2, y: 0.3, width: 0.25, height: 0.15 }],
      },
    };
    expect(isOcclusionCard(qaOcclusion)).toBe(true);
    const res = evaluateCardOcclusion(qaOcclusion);
    expect(res.kind).toBe("valid");
    if (res.kind === "valid") {
      expect(res.assetId).toBe("asset-brain");
      expect(res.regions).toEqual([
        expect.objectContaining({ id: "r1", x: 20, y: 30, width: 25, height: 15 }),
      ]);
    }
  });

  it("treats non-occlusion cards with plain image_asset_ids as not_occlusion", () => {
    const plainVisualCard = {
      id: "plain-1",
      item_type: "Flashcard",
      question: "What is shown?",
      answer: "A diagram",
      image_asset_ids: ["asset-1"],
    };
    expect(isOcclusionCard(plainVisualCard)).toBe(false);
    expect(evaluateCardOcclusion(plainVisualCard)).toEqual({ kind: "not_occlusion" });
  });

  it("normalizes [0..1] fractional coordinates and preserves [0..100] coordinates", () => {
    const frac = normalizeAndValidateOcclusionRegions([
      { id: "r1", x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      { id: "r2", x: 0.4, y: 0.9, width: 0.3, height: 0.1 },
    ]);
    expect(frac.ok).toBe(true);
    if (frac.ok) {
      expect(frac.regions[0]).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
      expect(frac.regions[1]).toMatchObject({ x: 40, y: 90, width: 30, height: 10 });
    }

    const pct = normalizeAndValidateOcclusionRegions([
      { id: "p1", x: 0, y: 0.5, width: 25, height: 10 },
    ]);
    expect(pct.ok).toBe(true);
    if (pct.ok) {
      // x=0 and y=0.5 stay 0% and 0.5% because width=25 is in [0..100] space
      expect(pct.regions[0]).toMatchObject({ x: 0, y: 0.5, width: 25, height: 10 });
    }
  });

  it("rejects empty, non-finite, zero-extent, or out-of-bounds geometry as invalid_geometry", () => {
    expect(
      evaluateCardOcclusion({
        item_type: "Qa",
        interaction_metadata: { interactionType: "image-occlusion", imageOcclusionRegions: [] },
      }),
    ).toMatchObject({ kind: "invalid_geometry", reason: "empty_regions" });

    expect(
      evaluateCardOcclusion({
        item_type: "Qa",
        interaction_metadata: {
          imageOcclusionAssetId: "asset-1",
          imageOcclusionRegions: [{ x: Number.NaN, y: 10, width: 20, height: 20 }],
        },
      }),
    ).toMatchObject({ kind: "invalid_geometry", reason: "non_finite_region" });

    expect(
      evaluateCardOcclusion({
        item_type: "Qa",
        interaction_metadata: {
          imageOcclusionRegions: [{ x: 10, y: 10, width: 0, height: 20 }],
        },
      }),
    ).toMatchObject({ kind: "invalid_geometry", reason: "non_positive_extent" });

    // Fractional region overflowing right edge: 0.8 + 0.5 = 1.3 > 1.0
    expect(
      evaluateCardOcclusion({
        item_type: "Qa",
        interaction_metadata: {
          imageOcclusionRegions: [{ x: 0.8, y: 0.1, width: 0.5, height: 0.2 }],
        },
      }),
    ).toMatchObject({ kind: "invalid_geometry", reason: "out_of_bounds_region" });

    // Percent region overflowing bottom edge: 85 + 25 = 110 > 100
    expect(
      evaluateCardOcclusion({
        item_type: "Qa",
        interaction_metadata: {
          imageOcclusionRegions: [{ x: 10, y: 85, width: 20, height: 25 }],
        },
      }),
    ).toMatchObject({ kind: "invalid_geometry", reason: "out_of_bounds_region" });
  });

  it("computes target-only vs reveal-all overlay visibility in authored order", () => {
    const evalRes = evaluateCardOcclusion({
      item_type: "Qa",
      image_asset_ids: ["asset-1"],
      interaction_metadata: {
        occlusionMode: "hide-all",
        targetRegionId: "r2",
        imageOcclusionRegions: [
          { id: "r1", x: 10, y: 10, width: 20, height: 10 },
          { id: "r2", x: 40, y: 40, width: 20, height: 10 },
          { id: "r3", x: 70, y: 70, width: 20, height: 10 },
        ],
      },
    });
    expect(evalRes.kind).toBe("valid");
    if (evalRes.kind === "valid") {
      expect(computeVisibleOcclusionOverlays(evalRes, false, false).map((r) => r.id)).toEqual([
        "r1",
        "r2",
        "r3",
      ]);
      expect(computeVisibleOcclusionOverlays(evalRes, true, false).map((r) => r.id)).toEqual([
        "r1",
        "r3",
      ]);
      expect(computeVisibleOcclusionOverlays(evalRes, true, true)).toEqual([]);
    }
  });
});
