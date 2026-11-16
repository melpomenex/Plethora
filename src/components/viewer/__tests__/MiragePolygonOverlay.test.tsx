import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MiragePolygonOverlay } from "../MiragePolygonOverlay";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";

describe("MiragePolygonOverlay", () => {
  it("renders polygon masks and rect regions and triggers onRegionClick", () => {
    const onRegionClick = vi.fn();
    const regions: ImageOcclusionRegion[] = [
      {
        id: "poly-1",
        x: 10,
        y: 20,
        width: 30,
        height: 30,
        label: "Mitral Valve",
        points: [
          { x: 10, y: 20 },
          { x: 40, y: 20 },
          { x: 25, y: 50 },
        ],
      },
      {
        id: "rect-1",
        x: 55,
        y: 60,
        width: 20,
        height: 10,
        label: "Aorta",
      },
    ];

    render(
      <MiragePolygonOverlay
        regions={regions}
        onRegionClick={onRegionClick}
        createdRegionIds={new Set(["rect-1"])}
      />
    );

    const rendered = screen.getAllByTestId("mirage-overlay-region");
    expect(rendered).toHaveLength(2);
    expect(rendered[0].tagName.toLowerCase()).toBe("polygon");
    expect(rendered[0].getAttribute("data-created")).toBe("false");
    expect(rendered[1].tagName.toLowerCase()).toBe("rect");
    expect(rendered[1].getAttribute("data-created")).toBe("true");

    fireEvent.click(rendered[0]);
    expect(onRegionClick).toHaveBeenCalledTimes(1);
    expect(onRegionClick).toHaveBeenCalledWith(regions[0]);
  });
});
