import { describe, it, expect } from "vitest";
import { normalizeHighlightColor } from "../highlightColors";

describe("normalizeHighlightColor", () => {
  it("should fall back to yellow translucent color when input is null, undefined, or empty", () => {
    const defaultYellow = "rgba(245, 158, 11, 0.20)";
    expect(normalizeHighlightColor(null)).toBe(defaultYellow);
    expect(normalizeHighlightColor(undefined)).toBe(defaultYellow);
    expect(normalizeHighlightColor("")).toBe(defaultYellow);
  });

  it("should resolve semantic color names to translucent versions", () => {
    expect(normalizeHighlightColor("yellow")).toBe("rgba(245, 158, 11, 0.20)");
    expect(normalizeHighlightColor("green")).toBe("rgba(34, 197, 94, 0.20)");
    expect(normalizeHighlightColor("blue")).toBe("rgba(59, 130, 246, 0.20)");
    expect(normalizeHighlightColor("pink")).toBe("rgba(236, 72, 153, 0.20)");
    expect(normalizeHighlightColor("purple")).toBe("rgba(168, 85, 247, 0.20)");
  });

  it("should resolve known persisted pastel hex aliases to translucent versions", () => {
    expect(normalizeHighlightColor("#fef08a")).toBe("rgba(245, 158, 11, 0.20)");
    expect(normalizeHighlightColor("#bbf7d0")).toBe("rgba(34, 197, 94, 0.20)");
    expect(normalizeHighlightColor("#bfdbfe")).toBe("rgba(59, 130, 246, 0.20)");
    expect(normalizeHighlightColor("#fbcfe8")).toBe("rgba(236, 72, 153, 0.20)");
    expect(normalizeHighlightColor("#e9d5ff")).toBe("rgba(168, 85, 247, 0.20)");
  });

  it("should resolve legacy high-opacity colors to translucent versions", () => {
    expect(normalizeHighlightColor("rgba(255, 235, 59, 0.5)")).toBe("rgba(245, 158, 11, 0.20)");
    expect(normalizeHighlightColor("rgba(76, 175, 80, 0.4)")).toBe("rgba(34, 197, 94, 0.20)");
    expect(normalizeHighlightColor("rgba(33, 150, 243, 0.4)")).toBe("rgba(59, 130, 246, 0.20)");
    expect(normalizeHighlightColor("rgba(233, 30, 99, 0.4)")).toBe("rgba(236, 72, 153, 0.20)");
    expect(normalizeHighlightColor("rgba(156, 39, 176, 0.4)")).toBe("rgba(168, 85, 247, 0.20)");
  });

  it("should preserve custom valid CSS colors that are not mapped", () => {
    expect(normalizeHighlightColor("#ff0000")).toBe("#ff0000");
    expect(normalizeHighlightColor("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
    expect(normalizeHighlightColor("currentColor")).toBe("currentColor");
  });

  it("should enforce constraints on alpha/opacity (all resolved values must be between 18% and 25%)", () => {
    const semanticColors = ["yellow", "green", "blue", "pink", "purple", "orange", "red"];
    for (const color of semanticColors) {
      const resolved = normalizeHighlightColor(color);
      expect(resolved).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*(0\.\d+)\)$/);
      const match = resolved.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*(0\.\d+)\)/);
      if (match) {
        const alpha = parseFloat(match[1]);
        expect(alpha).toBeGreaterThanOrEqual(0.18);
        expect(alpha).toBeLessThanOrEqual(0.25);
      }
    }
  });

  it("should be case-insensitive and handle whitespace variations", () => {
    expect(normalizeHighlightColor("  YELLOW  ")).toBe("rgba(245, 158, 11, 0.20)");
    expect(normalizeHighlightColor("#BBF7D0")).toBe("rgba(34, 197, 94, 0.20)");
    expect(normalizeHighlightColor("rgba( 255 , 235 , 59 , 0.5 )")).toBe("rgba(245, 158, 11, 0.20)");
  });
});
