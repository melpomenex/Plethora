import { describe, expect, it } from "vitest";
import {
  extractImageRegionsFromOperatorList,
  hitTestPdfImageRegions,
  mergeAdjacentImageRects,
  PDF_IMAGE_OPS,
  pdfRectToViewportRect,
  viewportRectToClientRect,
} from "../pdfImageRegions";

const OPS = PDF_IMAGE_OPS;

describe("pdfImageRegions", () => {
  it("extracts image bounding boxes from save/transform/paintImageXObject sequences", () => {
    const regions = extractImageRegionsFromOperatorList(
      {
        fnArray: [
          OPS.save,
          OPS.transform,
          OPS.paintImageXObject,
          OPS.restore,
          OPS.save,
          OPS.transform,
          OPS.paintInlineImageXObject,
          OPS.restore,
        ],
        argsArray: [
          [],
          [200, 0, 0, 150, 50, 400],
          ["img_p0_1", 400, 300],
          [],
          [],
          [120, 0, 0, 80, 300, 100],
          [{ width: 120, height: 80 }],
          [],
        ],
      },
      [0, 0, 612, 792],
    );

    expect(regions).toHaveLength(2);
    expect(regions[0].pdfRect).toEqual({ x0: 50, y0: 400, x1: 250, y1: 550 });
    expect(regions[1].pdfRect).toEqual({ x0: 300, y0: 100, x1: 420, y1: 180 });
  });

  it("respects Form XObject transforms and bbox clipping", () => {
    const regions = extractImageRegionsFromOperatorList(
      {
        fnArray: [
          OPS.paintFormXObjectBegin,
          OPS.transform,
          OPS.paintImageXObject,
          OPS.paintFormXObjectEnd,
        ],
        argsArray: [
          [
            [1, 0, 0, 1, 100, 200], // translate form by (100, 200)
            [0, 0, 150, 100], // clip form to [0..150, 0..100] in form space -> [100..250, 200..300]
          ],
          [300, 0, 0, 200, -50, -50], // oversized image inside form
          ["img_form", 300, 200],
          [],
        ],
      },
      [0, 0, 612, 792],
    );

    expect(regions).toHaveLength(1);
    expect(regions[0].pdfRect).toEqual({ x0: 100, y0: 200, x1: 250, y1: 300 });
  });

  it("skips images painted inside soft-mask groups while keeping CTM balanced", () => {
    const regions = extractImageRegionsFromOperatorList(
      {
        fnArray: [
          OPS.beginGroup,
          OPS.transform,
          OPS.paintImageXObject,
          OPS.endGroup,
          OPS.transform,
          OPS.paintImageXObject,
        ],
        argsArray: [
          [{ smask: { subtype: "Luminosity" }, bbox: [0, 0, 612, 792] }],
          [200, 0, 0, 200, 10, 10],
          ["smask_img", 200, 200],
          [{ smask: { subtype: "Luminosity" } }],
          [180, 0, 0, 120, 40, 50],
          ["real_img", 180, 120],
        ],
      },
      [0, 0, 612, 792],
    );

    expect(regions).toHaveLength(1);
    expect(regions[0].pdfRect).toEqual({ x0: 40, y0: 50, x1: 220, y1: 170 });
  });

  it("merges tiled/striped image slices before filtering small heights", () => {
    const regions = extractImageRegionsFromOperatorList(
      {
        fnArray: [
          OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
          OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
          OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
        ],
        argsArray: [
          [], [300, 0, 0, 15, 50, 100], ["strip_1"], [],
          [], [300, 0, 0, 15, 50, 115], ["strip_2"], [],
          [], [300, 0, 0, 15, 50, 130], ["strip_3"], [],
        ],
      },
      [0, 0, 612, 792],
    );

    expect(regions).toHaveLength(1);
    expect(regions[0].pdfRect).toEqual({ x0: 50, y0: 100, x1: 350, y1: 145 });
  });

  it("does not merge distinct figures separated by a gap", () => {
    const merged = mergeAdjacentImageRects([
      { x0: 50, y0: 100, x1: 200, y1: 200 },
      { x0: 220, y0: 100, x1: 370, y1: 200 },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("filters out tiny decorative icons and thin spacer rules", () => {
    const regions = extractImageRegionsFromOperatorList(
      {
        fnArray: [
          OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
          OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
          OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore,
        ],
        argsArray: [
          [], [1, 0, 0, 1, 0, 0], ["spacer"], [],
          [], [400, 0, 0, 4, 50, 300], ["rule"], [],
          [], [100, 0, 0, 80, 50, 400], ["figure"], [],
        ],
      },
      [0, 0, 612, 792],
    );

    expect(regions).toHaveLength(1);
    expect(regions[0].pdfRect).toEqual({ x0: 50, y0: 400, x1: 150, y1: 480 });
  });

  it("projects PDF user rects through viewport transform and picks smallest overlapping hit", () => {
    // Standard 1:1 unrotated viewport for a 612x792 page: flips Y via [1, 0, 0, -1, 0, 792]
    const viewport = {
      transform: [1, 0, 0, -1, 0, 792],
      width: 612,
      height: 792,
    };

    const background = { id: "img-0", pdfRect: { x0: 0, y0: 0, x1: 612, y1: 792 } };
    const inset = { id: "img-1", pdfRect: { x0: 100, y0: 500, x1: 300, y1: 650 } };

    // Inset in viewport space: left=100..300, top=792-650=142 .. 792-500=292
    expect(pdfRectToViewportRect(inset.pdfRect, viewport)).toEqual({
      left: 100,
      top: 142,
      width: 200,
      height: 150,
    });

    // Point inside both background and inset picks the smaller inset image
    const hitInset = hitTestPdfImageRegions([background, inset], viewport, 150, 200);
    expect(hitInset?.region.id).toBe("img-1");

    // Point outside inset picks background
    const hitBg = hitTestPdfImageRegions([background, inset], viewport, 20, 20);
    expect(hitBg?.region.id).toBe("img-0");
  });

  it("clamps client rects to the visible scroll container bounds", () => {
    const clientRect = viewportRectToClientRect(
      { left: 50, top: 0, width: 300, height: 400 },
      { left: 100, top: -150, width: 600, height: 800 },
      { width: 600, height: 800 },
      { left: 80, top: 60, right: 900, bottom: 700 },
    );

    expect(clientRect).toEqual({
      left: 150,
      top: 60,
      width: 300,
      height: 190,
    });
  });
});
