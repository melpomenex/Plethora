/**
 * Debug overlay geometry (seam audit): the overlay sits on the rendered page,
 * which applies the viewer rotation, while model rects live in unrotated PDF
 * user space — the boxes must track the render at every rotation.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PdfCanonicalDebugOverlay } from "../PdfCanonicalDebugOverlay";
import type { PdfCanonicalPage } from "../../../types/pdfCanonical";

/** Letter portrait page in user space; one figure block mid-page. */
const W = 612;
const H = 792;
const FIGURE = { x0: 100, y0: 300, x1: 500, y1: 600 };

function page(rotation: number): PdfCanonicalPage {
  return {
    pageNumber: 1,
    width: W,
    height: H,
    rotation,
    state: "ready",
    classification: "semantic",
    confidence: 0.9,
    textCoverage: 0.2,
    words: [],
    lines: [],
    blocks: [
      {
        id: "p1:b0",
        kind: "figure",
        role: "body",
        pageNumber: 1,
        sourceRegions: [{ pageNumber: 1, bbox: FIGURE }],
        wordIds: [],
        lineIds: [],
        readingOrder: 0,
        confidence: 0.5,
        text: "",
        direction: "auto",
        language: null,
        items: null,
        table: null,
        assetId: null,
        altText: null,
        captionOf: null,
        href: null,
        extraction: "graphical",
      },
    ],
    warnings: [],
    errorCategory: null,
    schemaVersion: 2,
    engineVersion: "rust-hybrid-v3",
  };
}

/** Displayed CSS size at scale 1: axes swap on quarter rotations. */
function displaySize(rotation: number): { w: number; h: number } {
  return rotation % 180 === 90 ? { w: H, h: W } : { w: W, h: H };
}

function boxStyle(rotation: number) {
  const { w, h } = displaySize(rotation);
  const { container } = render(
    <PdfCanonicalDebugOverlay
      page={page(rotation)}
      rotation={rotation}
      viewportWidth={w}
      viewportHeight={h}
    />,
  );
  const box = container.querySelector<HTMLElement>("div.absolute.border-2")!;
  return box.style;
}

describe("PdfCanonicalDebugOverlay rotation basis", () => {
  it("places the box under the render at rotation 0 (y flip only)", () => {
    const style = boxStyle(0);
    // left = x0; top = (1 − y1/H) · H; size 400 × 300.
    expect(style.left).toBe("100px");
    expect(style.top).toBe("192px");
    expect(style.width).toBe("400px");
    expect(style.height).toBe("300px");
  });

  it("maps through quarter rotation (box size swaps with the render)", () => {
    // Rotation 90: vx = y·s, vy = x·s — the figure's 400×300 box becomes
    // 300×400 at left = y0 = 300, top = x0 = 100 on the swapped H×W render.
    const style = boxStyle(90);
    expect(style.left).toBe("300px");
    expect(style.top).toBe("100px");
    expect(style.width).toBe("300px");
    expect(style.height).toBe("400px");
  });

  it("maps through 180 and 270", () => {
    // 180: vx = (W−x)·s, vy = y·s → left = 612 − 500, top = y0 = 300.
    const s180 = boxStyle(180);
    expect(s180.left).toBe("112px");
    expect(s180.top).toBe("300px");
    expect(s180.width).toBe("400px");
    expect(s180.height).toBe("300px");
    // 270: vx = (H−y)·s, vy = (W−x)·s → left = 792 − 600, top = 612 − 500.
    const s270 = boxStyle(270);
    expect(s270.left).toBe("192px");
    expect(s270.top).toBe("112px");
    expect(s270.width).toBe("300px");
    expect(s270.height).toBe("400px");
  });
});
