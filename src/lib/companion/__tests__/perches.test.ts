/**
 * Perch discovery + flight math tests (spec: companion-presentation,
 * interactivity requirements). Pure functions over rects — jsdom provides the
 * `document` for discovery filtering.
 */
import { describe, expect, it } from "vitest";
import {
  arcPoint,
  chooseDropOutcome,
  flightDurationMs,
  floorSpot,
  nearestPerchSpot,
  randomOtherSpot,
  SNAP_RADIUS,
  discoverPerchSpots,
  spotsAlongEdge,
} from "../perches";

const viewport = { width: 1280, height: 800 };

describe("perch spots", () => {
  it("spreads spots along a wide enough edge", () => {
    const rect = { left: 100, top: 200, width: 400, height: 40 };
    const spots = spotsAlongEdge(rect, 200, viewport, "panel", "p1");
    expect(spots.map((s) => s.id)).toEqual(["p1:0", "p1:1", "p1:2"]);
    expect(spots[0].x).toBeCloseTo(100 + 400 * 0.18, 0);
    expect(spots[1].x).toBeCloseTo(300, 0);
    expect(spots.every((s) => s.y === 200)).toBe(true);
  });

  it("rejects edges that are too narrow to stand on", () => {
    expect(spotsAlongEdge({ left: 0, top: 100, width: 40, height: 10 }, 100, viewport, "panel", "x")).toEqual([]);
  });

  it("drops spots that fall outside the viewport", () => {
    const rect = { left: 1240, top: 400, width: 300, height: 20 };
    const spots = spotsAlongEdge(rect, 400, viewport, "panel", "x");
    expect(spots.length).toBeLessThan(3);
  });

  it("floor spot puts the feet right at the viewport bottom", () => {
    expect(floorSpot(viewport).y).toBe(796);
    expect(floorSpot(viewport, 16).y).toBe(784);
    expect(floorSpot(viewport).kind).toBe("floor");
  });
});

describe("nearest perch and drop outcomes", () => {
  const spots = [
    { id: "a", x: 100, y: 100, kind: "panel" as const },
    { id: "b", x: 600, y: 300, kind: "panel" as const },
  ];

  it("finds the nearest spot within the snap radius", () => {
    expect(nearestPerchSpot(spots, { x: 640, y: 330 }, SNAP_RADIUS)?.id).toBe("b");
    expect(nearestPerchSpot(spots, { x: 500, y: 500 }, SNAP_RADIUS)).toBeNull();
  });

  it("a drop near a perch snaps onto it", () => {
    const outcome = chooseDropOutcome({ x: 610, y: 310 }, spots, viewport);
    expect(outcome.kind).toBe("snap");
    if (outcome.kind === "snap") expect(outcome.spot.id).toBe("b");
  });

  it("a drop in open space falls to the floor and then flies to a perch", () => {
    // (400,500) is >200px from every spot — clearly open space.
    const outcome = chooseDropOutcome({ x: 400, y: 500 }, spots, viewport);
    expect(outcome.kind).toBe("fall");
    if (outcome.kind === "fall") {
      expect(outcome.floorY).toBe(viewport.height - 6);
      expect(outcome.thenFlyTo?.id).toBe("b");
    }
  });

  it("random wandering picks a different, non-floor spot", () => {
    for (let i = 0; i < 20; i++) {
      const pick = randomOtherSpot([...spots, floorSpot(viewport)], "a");
      if (pick) {
        expect(pick.id).not.toBe("a");
        expect(pick.kind).not.toBe("floor");
      }
    }
  });
});

describe("flight math", () => {
  const from = { x: 0, y: 700 };
  const to = { x: 900, y: 200 };

  it("interpolates monotonically between endpoints", () => {
    expect(arcPoint(from, to, 0)).toEqual(from);
    const end = arcPoint(from, to, 1);
    expect(end.x).toBeCloseTo(to.x, 5);
    expect(end.y).toBeCloseTo(to.y, 5);
    const mid = arcPoint(from, to, 0.5);
    expect(mid.x).toBeCloseTo(450, 5);
  });

  it("lifts mid-flight (crest above the straight line)", () => {
    const mid = arcPoint(from, to, 0.5);
    const lineY = from.y + (to.y - from.y) * 0.5;
    expect(mid.y).toBeLessThan(lineY);
  });

  it("clamps t outside [0,1]", () => {
    expect(arcPoint(from, to, -1)).toEqual(from);
    expect(arcPoint(from, to, 5).x).toBeCloseTo(to.x, 5);
  });

  it("duration grows with distance and stays bounded", () => {
    const short = flightDurationMs({ x: 0, y: 0 }, { x: 10, y: 10 });
    const long = flightDurationMs({ x: 0, y: 0 }, { x: 2000, y: 1500 });
    expect(short).toBeGreaterThanOrEqual(500);
    expect(long).toBeLessThanOrEqual(1600);
    expect(long).toBeGreaterThan(short);
  });
});

describe("button perch discovery", () => {
  function mockRect(el: HTMLElement, rect: { x: number; y: number; w: number; h: number }) {
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.w,
        bottom: rect.y + rect.h,
        width: rect.w,
        height: rect.h,
        x: rect.x,
        y: rect.y,
        toJSON: () => ({}),
      }),
    });
    // jsdom has no layout — fake a non-null offset parent so the visibility
    // check passes, mirroring a rendered element.
    Object.defineProperty(el, "offsetParent", { value: document.body });
  }

  it("discovers text buttons like 'Open Document' as perch spots", () => {
    document.body.innerHTML = "";
    const openDoc = document.createElement("button");
    openDoc.textContent = "Open Document";
    mockRect(openDoc, { x: 200, y: 300, w: 160, h: 40 });
    document.body.appendChild(openDoc);

    const spots = discoverPerchSpots(viewport);
    expect(spots.some((s) => s.kind === "button" && s.x > 200 && s.x < 360 && s.y === 300)).toBe(true);
    // The floor is always available.
    expect(spots.some((s) => s.kind === "floor")).toBe(true);
  });

  it("skips icon-only (too narrow) and off-screen buttons", () => {
    document.body.innerHTML = "";
    const tiny = document.createElement("button");
    tiny.textContent = "×";
    mockRect(tiny, { x: 50, y: 300, w: 28, h: 28 });
    const offscreen = document.createElement("button");
    offscreen.textContent = "Hidden";
    mockRect(offscreen, { x: 50, y: 795, w: 120, h: 32 });
    document.body.append(tiny, offscreen);

    const spots = discoverPerchSpots(viewport);
    expect(spots.some((s) => s.kind === "button")).toBe(false);
  });
});
