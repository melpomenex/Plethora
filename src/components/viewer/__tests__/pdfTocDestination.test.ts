import { describe, expect, it } from "vitest";

import { pdfDestinationPoint, pdfDestinationScale, pdfReflowDestinationBlock } from "../pdfTocDestination";

// A viewport contract with nontrivial zoom/rotation transforms. The viewer
// delegates PDF-space conversion to PDF.js instead of flipping/scaling y itself.
const viewport = (scale = 1, rotation = 0) => ({
  viewBox: [0, 0, 600, 800],
  convertToViewportPoint: (x: number, y: number) => {
    if (rotation === 90) return [y * scale, x * scale];
    if (rotation === 180) return [(600 - x) * scale, y * scale];
    if (rotation === 270) return [(800 - y) * scale, (600 - x) * scale];
    return [x * scale, (800 - y) * scale];
  },
});
const dest = (kind: string, ...coords: any[]) => [0, { name: kind }, ...coords];

describe("PDF destinations", () => {
  it("separates headings on the same page", () => {
    expect(pdfDestinationPoint(dest("XYZ", 0, 700, null), viewport()).y).toBe(100);
    expect(pdfDestinationPoint(dest("XYZ", 0, 200, null), viewport()).y).toBe(600);
  });
  it.each([0, 90, 180, 270])("uses PDF.js zoom and rotation transforms (%i degrees)", (rotation) => {
    const vp = viewport(2, rotation);
    const [x, y] = vp.convertToViewportPoint(50, 650);
    expect(pdfDestinationPoint(dest("XYZ", 50, 650, 2), vp)).toEqual({ x, y });
  });
  it("preserves null XYZ axes and supports all fit destination types", () => {
    expect(pdfDestinationPoint(dest("XYZ", null, null, null), viewport())).toEqual({ x: null, y: null });
    for (const kind of ["FitH", "FitBH"]) expect(pdfDestinationPoint(dest(kind, 600), viewport()).y).toBe(200);
    for (const kind of ["FitV", "FitBV"]) expect(pdfDestinationPoint(dest(kind, 50), viewport()).x).toBe(50);
    for (const kind of ["Fit", "FitB"]) expect(pdfDestinationPoint(dest(kind), viewport())).toEqual({ x: 0, y: 0 });
    expect(pdfDestinationPoint(dest("FitR", 50, 200, 300, 600), viewport())).toEqual({ x: 50, y: 200 });
  });
  it("honors explicit zoom and fit zoom using rotated geometry", () => {
    expect(pdfDestinationScale(dest("XYZ", 0, 700, 2), viewport(), 632, 832)).toBe(2);
    expect(pdfDestinationScale(dest("XYZ", 0, 700, null), viewport(), 632, 832)).toBeNull();
    for (const kind of ["Fit", "FitB", "FitH", "FitBH", "FitV", "FitBV"]) {
      expect(pdfDestinationScale(dest(kind, 700), viewport(), 632, 832)).toBe(1);
    }
    expect(pdfDestinationScale(dest("FitH", 700), viewport(1, 90), 632, 832)).toBe(0.75);
    expect(pdfDestinationScale(dest("FitR", 50, 200, 350, 600), viewport(), 632, 832)).toBe(2);
  });
  it("maps a TOC destination to the source block rather than reflow page start", () => {
    const blocks = [700, 200].map((top, i) => ({
      id: `heading-${i}`, role: "body", sourceRegions: [{ bbox: { x0: 0, x1: 500, y0: top - 20, y1: top } }],
    }));
    expect(pdfReflowDestinationBlock(dest("XYZ", 0, 200, null), viewport(), blocks as any)).toBe("heading-1");
    expect(pdfReflowDestinationBlock(dest("FitH", 700), viewport(), blocks as any)).toBe("heading-0");
  });
  it("transforms prototype source rectangles from PDF space too", () => {
    const blocks = [700, 200].map((y, i) => ({ id: `b${i}`, source: { rects: [{ x: 0, y: y - 20, width: 500, height: 20 }] } }));
    expect(pdfReflowDestinationBlock(dest("XYZ", 0, 200, null), viewport(), [], blocks as any)).toBe("b1");
  });
});
