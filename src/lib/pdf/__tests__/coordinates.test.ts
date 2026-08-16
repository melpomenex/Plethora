/**
 * Coordinate-transform tests (task 3.5): the TS transforms must round-trip
 * for every rotation, matching the Rust module's contracts (same formulas —
 * see `src-tauri/src/pdf/coordinates.rs`).
 */
import { describe, expect, it } from "vitest";
import {
  canonicalFromLegacyRect,
  legacyFromCanonicalRect,
  pdfPointToRaster,
  pdfRectToRaster,
  rasterPointToPdf,
  rasterRectToPdf,
  unionPdfRects,
  type RasterGeometry,
} from "../coordinates";

const W = 612;
const H = 792;

function geometry(rotation: 0 | 90 | 180 | 270): RasterGeometry {
  const s = 2;
  const [rw, rh] =
    rotation === 90 || rotation === 270 ? [H * s, W * s] : [W * s, H * s];
  return { width: rw, height: rh, scale: s, rotation, pageWidth: W, pageHeight: H };
}

describe("pdf coordinates", () => {
  it("rotation 0 flips y at the page top", () => {
    const [vx, vy] = pdfPointToRaster(0, H, geometry(0));
    expect([vx, vy]).toEqual([0, 0]);
  });

  it("rotation 90 maps the page top-left to the display top-right", () => {
    const [vx, vy] = pdfPointToRaster(0, H, geometry(90));
    expect([vx, vy]).toEqual([H * 2, 0]);
  });

  it("points round-trip for every rotation", () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [W, H],
      [100.5, 333.25],
    ];
    for (const rotation of [0, 90, 180, 270] as const) {
      const g = geometry(rotation);
      for (const [x, y] of points) {
        const [vx, vy] = pdfPointToRaster(x, y, g);
        const [rx, ry] = rasterPointToPdf(vx, vy, g);
        expect(Math.abs(rx - x)).toBeLessThan(1e-9);
        expect(Math.abs(ry - y)).toBeLessThan(1e-9);
      }
    }
  });

  it("rects round-trip and quarter rotations swap dimensions", () => {
    const rect = { x0: 72, y0: 96.5, x1: 300.25, y1: 700 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const g = geometry(rotation);
      const raster = pdfRectToRaster(rect, g);
      const back = rasterRectToPdf(raster, g);
      expect(Math.abs(back.x0 - rect.x0)).toBeLessThan(1e-9);
      expect(Math.abs(back.y1 - rect.y1)).toBeLessThan(1e-9);
    }
    const straight = pdfRectToRaster(rect, geometry(0));
    expect([straight.width, straight.height]).toEqual([456.5, 1207]);
    const turned = pdfRectToRaster(rect, geometry(90));
    expect([turned.width, turned.height]).toEqual([1207, 456.5]);
  });

  it("unions and legacy bridges behave", () => {
    expect(unionPdfRects([])).toBeNull();
    const union = unionPdfRects([
      { x0: 10, y0: 10, x1: 20, y1: 20 },
      { x0: 15, y0: 18, x1: 40, y1: 50 },
    ]);
    expect(union).toEqual({ x0: 10, y0: 10, x1: 40, y1: 50 });
    const legacy = canonicalFromLegacyRect({ x1: 30, y1: 40, x2: 10, y2: 20 });
    expect(legacy).toEqual({ x0: 10, y0: 20, x1: 30, y1: 40 });
    expect(legacyFromCanonicalRect(legacy)).toEqual({ x1: 10, y1: 20, x2: 30, y2: 40 });
  });
});
