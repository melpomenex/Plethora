import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PageViewport } from "pdfjs-dist";
import { SelectionOverlay } from "../SelectionOverlay";
import { pdfRectToViewportRect } from "../HighlightLayer";
import type { PdfRect } from "../../../types/selection";

function makeViewport(scale: number): PageViewport {
  return {
    scale,
    convertToViewportRectangle: vi.fn((rect: [number, number, number, number]) => {
      // A minimal affine mock: PDF points × scale = viewport pixels.
      return [rect[0] * scale, rect[1] * scale, rect[2] * scale, rect[3] * scale];
    }),
  } as unknown as PageViewport;
}

const PDF_RECT: PdfRect = { x1: 100, y1: 200, x2: 300, y2: 260 };

describe("pdfRectToViewportRect (overlay rect derivation)", () => {
  it("derives viewport rects from PDF-space rects through the current viewport", () => {
    const rect = pdfRectToViewportRect(PDF_RECT, makeViewport(1));
    expect(rect).toEqual({ left: 100, top: 200, width: 200, height: 60 });
  });

  it("re-derives exactly across a scale change — never from cached CSS pixels", () => {
    const at100 = pdfRectToViewportRect(PDF_RECT, makeViewport(1))!;
    const at200 = pdfRectToViewportRect(PDF_RECT, makeViewport(2))!;
    // 200% zoom doubles every dimension proportionally.
    expect(at200.left).toBeCloseTo(at100.left * 2);
    expect(at200.top).toBeCloseTo(at100.top * 2);
    expect(at200.width).toBeCloseTo(at100.width * 2);
    expect(at200.height).toBeCloseTo(at100.height * 2);
  });
});

describe("SelectionOverlay", () => {
  it("paints rects derived from the current viewport", () => {
    const { container } = render(
      <SelectionOverlay pageIndex={0} viewport={makeViewport(1)} pdfRects={[PDF_RECT]} />
    );
    const rects = container.querySelectorAll(".pdf-selection-rect");
    expect(rects.length).toBe(1);
    const el = rects[0] as HTMLElement;
    expect(el.style.left).toBe("100px");
    expect(el.style.top).toBe("200px");
    expect(el.style.width).toBe("200px");
    expect(el.style.height).toBe("60px");
  });

  it("re-positions when the viewport scale changes (re-render with a new viewport)", () => {
    const { container, rerender } = render(
      <SelectionOverlay pageIndex={0} viewport={makeViewport(1)} pdfRects={[PDF_RECT]} />
    );
    rerender(<SelectionOverlay pageIndex={0} viewport={makeViewport(2)} pdfRects={[PDF_RECT]} />);
    const el = container.querySelector(".pdf-selection-rect") as HTMLElement;
    expect(el.style.left).toBe("200px");
    expect(el.style.top).toBe("400px");
    expect(el.style.width).toBe("400px");
    expect(el.style.height).toBe("120px");
  });

  it("renders nothing when the page is not rendered (null viewport) or has no rects", () => {
    const { container: noViewport } = render(
      <SelectionOverlay pageIndex={0} viewport={null} pdfRects={[PDF_RECT]} />
    );
    expect(noViewport.querySelectorAll(".pdf-selection-rect").length).toBe(0);

    const { container: noRects } = render(
      <SelectionOverlay pageIndex={0} viewport={makeViewport(1)} pdfRects={[]} />
    );
    expect(noRects.querySelectorAll(".pdf-selection-rect").length).toBe(0);
  });
});
