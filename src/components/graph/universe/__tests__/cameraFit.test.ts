import { describe, it, expect } from "vitest";
import {
  MIN_HOME_DIST,
  anchorShift,
  computeCameraRange,
  computeUsableViewportOffset,
  fitDistance,
  minHalfFov,
  shouldFollowUpdatedHome,
} from "../cameraFit";
import { isTwoFingerTap, pinchZoomFactor, twistDelta } from "../gestureMath";

const FOV = 55; // engine baseFov

describe("fitDistance", () => {
  it("is limited by the vertical FOV on landscape viewports", () => {
    const halfV = (FOV / 2) * (Math.PI / 180);
    expect(fitDistance(100, FOV, 16 / 9)).toBeCloseTo(100 / Math.tan(halfV), 6);
    // Square viewports have equal FOV on both axes.
    expect(fitDistance(100, FOV, 1)).toBeCloseTo(100 / Math.tan(halfV), 6);
  });

  it("grows as the viewport narrows", () => {
    const landscape = fitDistance(100, FOV, 1.8);
    const portrait = fitDistance(100, FOV, 0.5);
    expect(portrait).toBeGreaterThan(landscape * 1.8);
  });
});

describe("computeCameraRange", () => {
  const bounds = 500;
  const core = 200;

  it("matches the legacy landscape formulas within tolerance", () => {
    const { homeDist, maxDist } = computeCameraRange(bounds, core, FOV, 16 / 9);
    // Legacy: maxDist = bounds × 2.6, homeDist = coreBounds × 2.2.
    expect(maxDist).toBeCloseTo(bounds * 2.6, 5);
    expect(homeDist).toBeGreaterThan(core * 2.0);
    expect(homeDist).toBeLessThan(core * 2.3);
  });

  it("lets portrait viewports pull back further than landscape", () => {
    const landscape = computeCameraRange(bounds, core, FOV, 16 / 9).maxDist;
    const portrait = computeCameraRange(bounds, core, FOV, 9 / 19.5).maxDist;
    expect(portrait).toBeGreaterThan(landscape * 1.5);
  });

  it("fits the whole universe at maxDist for every aspect from 0.45 to 2.0", () => {
    for (let aspect = 0.45; aspect <= 2.0; aspect += 0.05) {
      const { maxDist } = computeCameraRange(bounds, core, FOV, aspect);
      const visibleHalfExtent = maxDist * Math.tan(minHalfFov(FOV, aspect));
      expect(visibleHalfExtent).toBeGreaterThanOrEqual(bounds);
    }
  });

  it("frames the cluster core at homeDist for portrait and landscape", () => {
    for (const aspect of [0.45, 0.6, 1, 1.7]) {
      const { homeDist } = computeCameraRange(bounds, core, FOV, aspect);
      const visibleHalfExtent = homeDist * Math.tan(minHalfFov(FOV, aspect));
      expect(visibleHalfExtent).toBeGreaterThanOrEqual(core);
    }
  });

  it.each([
    ["portrait phone", 390 / 844],
    ["portrait tablet", 834 / 1194],
    ["landscape tablet", 1194 / 834],
    ["compact desktop", 1024 / 768],
    ["wide desktop", 1920 / 1080],
  ])("frames centered bounds on a %s viewport", (_name, aspect) => {
    const center = { x: 187, y: -42, z: 93 };
    const { homeDist, maxDist } = computeCameraRange(bounds, core, FOV, aspect);
    const homeHalfExtent = homeDist * Math.tan(minHalfFov(FOV, aspect));
    const maxHalfExtent = maxDist * Math.tan(minHalfFov(FOV, aspect));

    // Camera distance depends on extent and aspect, not the world's origin.
    expect(homeHalfExtent).toBeGreaterThanOrEqual(core);
    expect(maxHalfExtent).toBeGreaterThanOrEqual(bounds);
    expect(center).toEqual({ x: 187, y: -42, z: 93 });
  });

  it("keeps sane floors for degenerate layouts", () => {
    const { homeDist, maxDist } = computeCameraRange(0, 0, FOV, 0.5);
    expect(homeDist).toBe(MIN_HOME_DIST);
    expect(maxDist).toBeGreaterThanOrEqual(homeDist * 1.6);
  });

  it("keeps maxDist monotonically non-increasing as aspect widens", () => {
    let prev = Infinity;
    for (const aspect of [0.4, 0.6, 0.8, 1.0, 1.2]) {
      const { maxDist } = computeCameraRange(bounds, core, FOV, aspect);
      expect(maxDist).toBeLessThanOrEqual(prev);
      prev = maxDist;
    }
  });
});

describe("anchorShift", () => {
  it("keeps the anchor's screen offset ratio invariant when zooming", () => {
    const target = { x: 3, y: -2, z: 8 };
    const anchor = { x: 13, y: 4, z: 8 };
    const next = anchorShift(anchor, target, 100, 55);
    // Screen offset of a point on the target plane ∝ |point − target| / dist.
    expect((anchor.x - next.x) / 55).toBeCloseTo((anchor.x - target.x) / 100, 10);
    expect((anchor.y - next.y) / 55).toBeCloseTo((anchor.y - target.y) / 100, 10);
    expect((anchor.z - next.z) / 55).toBeCloseTo((anchor.z - target.z) / 100, 10);
  });

  it("moves the target toward the anchor when zooming in", () => {
    const target = { x: 0, y: 0, z: 0 };
    const anchor = { x: 10, y: 0, z: 0 };
    const zoomedIn = anchorShift(anchor, target, 100, 50);
    expect(zoomedIn.x).toBeCloseTo(5, 10);
    const zoomedOut = anchorShift(anchor, target, 100, 200);
    expect(zoomedOut.x).toBeCloseTo(-10, 10);
  });

  it("no-ops when anchor equals target, dist is unchanged, or distOld is invalid", () => {
    const t = { x: 1, y: 2, z: 3 };
    expect(anchorShift(t, t, 100, 50)).toEqual(t);
    expect(anchorShift({ x: 9, y: 9, z: 9 }, t, 80, 80)).toEqual(t);
    expect(anchorShift({ x: 9, y: 9, z: 9 }, t, 0, 40)).toEqual(t);
  });
});

describe("computeUsableViewportOffset", () => {
  it("uses zero offset when no panel consumes canvas space", () => {
    expect(computeUsableViewportOffset(1200, 856, false)).toBe(0);
    expect(computeUsableViewportOffset(1200, 1200, true)).toBe(0);
  });

  it("projects the target to the center of the unobscured left region", () => {
    const viewportWidth = 1200;
    const obstructionLeft = 856; // 320px panel plus a 24px right inset
    const offset = computeUsableViewportOffset(viewportWidth, obstructionLeft, true);

    expect(offset).toBe(172);
    expect(viewportWidth / 2 - offset).toBe(obstructionLeft / 2);
  });

  it("clamps obstruction geometry to the viewport", () => {
    expect(computeUsableViewportOffset(800, -50, true)).toBe(400);
    expect(computeUsableViewportOffset(800, 900, true)).toBe(0);
    expect(computeUsableViewportOffset(0, 200, true)).toBe(0);
  });
});

describe("shouldFollowUpdatedHome", () => {
  it("re-frames on a dataset replacement from any camera state, even panned far from home", () => {
    expect(
      shouldFollowUpdatedHome({ scopeChanged: true, focusLevel: "universe", isAtHomeView: false })
    ).toBe(true);
    expect(
      shouldFollowUpdatedHome({ scopeChanged: true, focusLevel: "universe", isAtHomeView: true })
    ).toBe(true);
  });

  it("preserves a deliberately panned camera on same-data edits", () => {
    expect(
      shouldFollowUpdatedHome({ scopeChanged: false, focusLevel: "universe", isAtHomeView: false })
    ).toBe(false);
  });

  it("keeps following home for same-data edits while the camera is already at home", () => {
    expect(
      shouldFollowUpdatedHome({ scopeChanged: false, focusLevel: "universe", isAtHomeView: true })
    ).toBe(true);
  });

  it("preserves system and node focus regardless of scope change", () => {
    expect(
      shouldFollowUpdatedHome({ scopeChanged: true, focusLevel: "system", isAtHomeView: false })
    ).toBe(false);
    expect(
      shouldFollowUpdatedHome({ scopeChanged: true, focusLevel: "node", isAtHomeView: true })
    ).toBe(false);
  });
});

describe("gestureMath", () => {
  it("pinchZoomFactor zooms out when fingers close and in when they spread", () => {
    expect(pinchZoomFactor(100, 50)).toBe(2); // fingers together → dist grows
    expect(pinchZoomFactor(100, 200)).toBe(0.5); // fingers apart → dist shrinks
    expect(pinchZoomFactor(0, 50)).toBe(1);
    expect(pinchZoomFactor(50, 0)).toBe(1);
  });

  it("twistDelta returns the signed shortest rotation, handling wrap-around", () => {
    expect(twistDelta(0, 0.25)).toBeCloseTo(0.25, 10);
    expect(twistDelta(0.25, 0)).toBeCloseTo(-0.25, 10);
    // Crossing the ±π seam of atan2 must not produce a ~2π jump.
    expect(twistDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 10);
    expect(twistDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 10);
  });

  it("classifies two-finger taps by duration and movement", () => {
    expect(isTwoFingerTap(120, 4)).toBe(true);
    expect(isTwoFingerTap(400, 4)).toBe(false); // held too long
    expect(isTwoFingerTap(120, 30)).toBe(false); // moved too far (a pinch)
  });
});
