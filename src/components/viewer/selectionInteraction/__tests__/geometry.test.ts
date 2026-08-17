import { describe, expect, it } from "vitest";
import {
  anchorRectFromGeometry,
  captureSelectionGeometry,
  fingerprintRange,
  placeAnchoredBar,
  type Rect,
  type SafeInsets,
  type SelectionGeometry,
  type ViewportLike,
} from "../geometry";

/** jsdom lays out nothing, so geometry construction goes through fakes. */
function geometry(rect: Rect, clientRects: Rect[] = [rect]): SelectionGeometry {
  return { rect, clientRects, fingerprint: "fp-test" };
}

/** Intersection of two rects (zero area when disjoint). */
function intersection(a: Rect, b: Rect): number {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

const BAR = { width: 260, height: 48 };
/** Boox Palma 2-class narrow viewport (~330×580 css px). */
const PALMA: ViewportLike = { width: 330, height: 580 };
const DESKTOP: ViewportLike = { width: 1280, height: 800 };

/** The rendered bar footprint for a placement. */
function barRect(p: { top: number; left: number; maxWidth: number }): Rect {
  return { left: p.left, top: p.top, width: p.maxWidth, height: BAR.height };
}

/** Assert the bar is fully inside the viewport minus insets and does not
 *  cover the anchor rect when any alternative exists. */
function expectSafePlacement(
  anchor: Rect,
  p: { top: number; left: number; maxWidth: number },
  viewport: ViewportLike,
  insets: SafeInsets = {},
) {
  const safeLeft = (insets.left ?? 0) + 8;
  const safeRight = (insets.right ?? 0) + 8;
  const safeTop = (insets.top ?? 0) + 8;
  const safeBottom = (insets.bottom ?? 0) + (insets.keyboard ?? 0) + 8;
  const bar = barRect(p);
  expect(bar.left).toBeGreaterThanOrEqual(safeLeft - 0.5);
  expect(bar.top).toBeGreaterThanOrEqual(safeTop - 0.5);
  expect(bar.left + bar.width).toBeLessThanOrEqual(viewport.width - safeRight + 0.5);
  expect(bar.top + BAR.height).toBeLessThanOrEqual(viewport.height - safeBottom + 0.5);
  // Never vertically centered over the passage: the bar must sit fully above
  // or fully below the anchor (or docked clear of it when unavoidable).
  const anchorBottom = anchor.top + anchor.height;
  const overlaps =
    intersection(bar, anchor) > 0 ||
    (bar.top < anchorBottom && bar.top + BAR.height > anchor.top);
  if (overlaps) {
    // Only tolerable when neither above nor below had room.
    const roomAbove = anchor.top - BAR.height - 8 >= safeTop;
    const roomBelow = anchorBottom + 8 + BAR.height <= viewport.height - safeBottom;
    expect(roomAbove || roomBelow).toBe(false);
  }
}

describe("placeAnchoredBar — every position in the viewport", () => {
  it("selection at center: bar goes above, centered on it, clamped horizontally", () => {
    const anchor = { left: 500, top: 400, width: 200, height: 20 };
    const p = placeAnchoredBar(anchor, BAR, DESKTOP);
    expect(p.placement).toBe("above");
    expect(p.top).toBe(anchor.top - 8 - BAR.height);
    expect(p.left).toBe(anchor.left + anchor.width / 2 - BAR.width / 2);
    expectSafePlacement(anchor, p, DESKTOP);
  });

  it("selection near the top: bar flips below", () => {
    const anchor = { left: 500, top: 30, width: 200, height: 20 };
    const p = placeAnchoredBar(anchor, BAR, DESKTOP);
    expect(p.placement).toBe("below");
    expect(p.top).toBe(anchor.top + anchor.height + 8);
    expectSafePlacement(anchor, p, DESKTOP);
  });

  it("selection near the bottom: bar stays above", () => {
    const anchor = { left: 500, top: DESKTOP.height - 60, width: 200, height: 20 };
    const p = placeAnchoredBar(anchor, BAR, DESKTOP);
    expect(p.placement).toBe("above");
    expectSafePlacement(anchor, p, DESKTOP);
  });

  it("selection at the left/right edges: bar clamped inside horizontally", () => {
    const left = { left: 0, top: 400, width: 60, height: 20 };
    const pl = placeAnchoredBar(left, BAR, DESKTOP);
    expect(pl.left).toBeGreaterThanOrEqual(8);
    expectSafePlacement(left, pl, DESKTOP);

    const right = { left: DESKTOP.width - 60, top: 400, width: 60, height: 20 };
    const pr = placeAnchoredBar(right, BAR, DESKTOP);
    expect(pr.left + pr.maxWidth).toBeLessThanOrEqual(DESKTOP.width - 8);
    expectSafePlacement(right, pr, DESKTOP);
  });

  it("taller-than-viewport selection docks to the roomier safe edge, never mid-passage", () => {
    const anchor = { left: 40, top: 0, width: 250, height: PALMA.height }; // fills everything
    const p = placeAnchoredBar(anchor, BAR, PALMA);
    expect(["docked-top", "docked-bottom"]).toContain(p.placement);
    expectSafePlacement(anchor, p, PALMA);
  });

  it("narrow (Palma 2-class) viewport: width is capped and placement stays inside", () => {
    const anchor = { left: 30, top: 300, width: 270, height: 20 };
    const p = placeAnchoredBar(anchor, BAR, PALMA);
    expect(p.maxWidth).toBeLessThanOrEqual(PALMA.width - 16);
    expectSafePlacement(anchor, p, PALMA);
  });

  it("respects safe-area insets and the on-screen keyboard", () => {
    const insets: SafeInsets = { top: 44, bottom: 24, left: 0, right: 0, keyboard: 260 };
    // Selection sits right where the keyboard starts: below has no room.
    const anchor = { left: 40, top: PALMA.height - 260 - 80, width: 200, height: 20 };
    const p = placeAnchoredBar(anchor, BAR, PALMA, insets);
    expect(p.top + BAR.height).toBeLessThanOrEqual(PALMA.height - 24 - 260 - 8 + 0.5);
    expectSafePlacement(anchor, p, PALMA, insets);
  });

  it("multi-line selection anchors on the whole bounding box without covering it", () => {
    const anchor = { left: 100, top: 300, width: 400, height: 120 };
    const p = placeAnchoredBar(anchor, BAR, DESKTOP);
    expect(p.placement).toBe("above");
    expectSafePlacement(anchor, p, DESKTOP);
  });

  it("bar wider than the viewport scrolls horizontally inside maxWidth instead of shrinking", () => {
    const wideBar = { width: 600, height: 48 };
    const anchor = { left: 30, top: 300, width: 270, height: 20 };
    const p = placeAnchoredBar(anchor, wideBar, PALMA);
    expect(p.maxWidth).toBe(PALMA.width - 16);
    expectSafePlacement(anchor, p, PALMA);
  });
});

describe("anchorRectFromGeometry — tall and multi-line selections", () => {
  it("uses the first client rect intersecting the viewport", () => {
    const g = geometry(
      { left: 0, top: -2000, width: 300, height: 4000 },
      [
        { left: 10, top: -2000, width: 300, height: 20 }, // offscreen above
        { left: 10, top: 100, width: 300, height: 20 }, // first visible
        { left: 10, top: 140, width: 300, height: 20 },
      ],
    );
    const anchor = anchorRectFromGeometry(g, PALMA);
    expect(anchor.top).toBe(100);
  });

  it("falls back to the edge-nearest rect when nothing intersects", () => {
    const g = geometry(
      { left: 0, top: -500, width: 300, height: 520 },
      [
        { left: 10, top: -500, width: 300, height: 20 },
        { left: 10, top: -480, width: 300, height: 500 }, // ends 20px above the fold
      ],
    );
    const anchor = anchorRectFromGeometry(g, PALMA);
    expect(anchor).toBe(g.clientRects[1]); // nearest to the visible area
  });

  it("uses the bounding rect when client rects are empty (zero-rect fallback)", () => {
    const rect = { left: 10, top: 100, width: 300, height: 20 };
    const g = geometry(rect, []);
    expect(anchorRectFromGeometry(g, PALMA)).toBe(rect);
  });
});

describe("fingerprintRange / captureSelectionGeometry", () => {
  it("fingerprint distinguishes ranges by container+offset and reports collapsed as null", () => {
    const doc = document.implementation.createHTMLDocument("t");
    const p = doc.createElement("p");
    p.textContent = "hello selection world";
    doc.body.appendChild(p);
    const text = p.firstChild!;

    const r1 = doc.createRange();
    r1.setStart(text, 0);
    r1.setEnd(text, 5);
    const r2 = doc.createRange();
    r2.setStart(text, 0);
    r2.setEnd(text, 5);
    const r3 = doc.createRange();
    r3.setStart(text, 6);
    r3.setEnd(text, 15);

    expect(fingerprintRange(r1)).toBe(fingerprintRange(r2)); // stable identity
    expect(fingerprintRange(r1)).not.toBe(fingerprintRange(r3)); // offset shift

    const collapsed = doc.createRange();
    collapsed.setStart(text, 3);
    collapsed.setEnd(text, 3);
    expect(fingerprintRange(collapsed)).toBeNull();
    expect(fingerprintRange(null)).toBeNull();
  });

  it("captureSelectionGeometry applies the iframe offset to every rect (EPUB bridge)", () => {
    const doc = document.implementation.createHTMLDocument("t");
    const p = doc.createElement("p");
    p.textContent = "hello selection world";
    doc.body.appendChild(p);
    const range = doc.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 5);
    // jsdom has no range layout; stub the two reads captureSelectionGeometry uses.
    const fakeRange = range as Range;
    const rect1 = new DOMRect(12, 34, 56, 18);
    const rect2 = new DOMRect(12, 52, 40, 18);
    fakeRange.getBoundingClientRect = () => rect1;
    fakeRange.getClientRects = () => [rect1, rect2] as unknown as DOMRectList;

    const offset = { x: 40, y: 120 }; // frameElement.getBoundingClientRect() top-left
    const direct = captureSelectionGeometry(fakeRange);
    const shifted = captureSelectionGeometry(fakeRange, offset);

    expect(shifted.rect).toEqual({ left: 52, top: 154, width: 56, height: 18 });
    expect(shifted.clientRects).toEqual([
      { left: 52, top: 154, width: 56, height: 18 },
      { left: 52, top: 172, width: 40, height: 18 },
    ]);
    expect(shifted.fingerprint).toBe(direct.fingerprint);
  });
});
