import { describe, expect, it } from "vitest";
import {
  resolveHeatmapNodeColor,
  computeLassoSelectedNodes,
} from "../ObsidianGraph";

describe("ObsidianGraph heatmap & Shift+Drag lasso", () => {
  it("resolves distinct colors for healthy, at-risk, and leech nodes in retrievability_leech mode", () => {
    const healthy = resolveHeatmapNodeColor(
      { id: "n1", retrievability: 0.95, lapses: 0 },
      "retrievability_leech"
    );
    const atRisk = resolveHeatmapNodeColor(
      { id: "n2", retrievability: 0.42, lapses: 1 },
      "retrievability_leech"
    );
    const leech = resolveHeatmapNodeColor(
      { id: "n3", retrievability: 0.9, lapses: 6 },
      "retrievability_leech"
    );

    expect(healthy).toBe("#10b981");
    expect(atRisk).toBe("#f97316");
    expect(leech).toBe("#ef4444");
    expect(new Set([healthy, atRisk, leech]).size).toBe(3);
  });

  it("maps unprocessedExtractCount tiers in extract_density mode", () => {
    expect(
      resolveHeatmapNodeColor({ id: "d0", unprocessedExtractCount: 0 }, "extract_density")
    ).toBe("#64748b");
    expect(
      resolveHeatmapNodeColor({ id: "d1", unprocessedExtractCount: 2 }, "extract_density")
    ).toBe("#38bdf8");
    expect(
      resolveHeatmapNodeColor({ id: "d2", unprocessedExtractCount: 5 }, "extract_density")
    ).toBe("#a855f7");
    expect(
      resolveHeatmapNodeColor({ id: "d3", unprocessedExtractCount: 11 }, "extract_density")
    ).toBe("#ec4899");
  });

  it("selects enclosed nodes from Shift+Drag lasso bounds under camera transform", () => {
    const nodes = [
      { id: "n1", x: 120, y: 120 },
      { id: "n2", x: 180, y: 160 },
      { id: "n3", x: 500, y: 500 },
    ];
    const selected = computeLassoSelectedNodes(
      nodes,
      { minX: 100, maxX: 220, minY: 100, maxY: 220 },
      { x: 0, y: 0, k: 1 }
    );
    expect(selected).toEqual(["n1", "n2"]);
  });
});
