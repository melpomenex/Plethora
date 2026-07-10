import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { HighlightLayer, type StoredHighlight } from "../HighlightLayer";
import type { PageViewport } from "pdfjs-dist";

// Mock PageViewport
const mockViewport = {
  convertToViewportRectangle: vi.fn((rect: [number, number, number, number]) => {
    return [rect[0], rect[1], rect[2], rect[3]];
  }),
} as unknown as PageViewport;

describe("HighlightLayer", () => {
  it("renders highlights with translucent resolved colors from the shared reader palette", () => {
    const highlights: StoredHighlight[] = [
      {
        id: "hl-yellow",
        pageNumber: 1,
        pdfRects: [{ x1: 10, y1: 20, x2: 100, y2: 40 }],
        color: "yellow",
        text: "yellow highlight text",
        createdAt: Date.now(),
      },
      {
        id: "hl-green",
        pageNumber: 1,
        pdfRects: [{ x1: 10, y1: 50, x2: 100, y2: 70 }],
        color: "green",
        text: "green highlight text",
        createdAt: Date.now(),
      },
    ];

    const { container } = render(
      <HighlightLayer
        pageIndex={0}
        viewport={mockViewport}
        highlights={highlights}
        interactive={true}
      />
    );

    // Get the rendered divs
    const renderedHighlights = container.querySelectorAll(".pdf-highlight");
    expect(renderedHighlights.length).toBe(2);

    // Verify colors are resolved through the shared translucent palette
    const yellowElement = renderedHighlights[0] as HTMLElement;
    expect(yellowElement.style.backgroundColor).toBe("rgba(245, 158, 11, 0.2)");

    const greenElement = renderedHighlights[1] as HTMLElement;
    expect(greenElement.style.backgroundColor).toBe("rgba(34, 197, 94, 0.2)");
  });
});
