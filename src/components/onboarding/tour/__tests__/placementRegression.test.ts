import { describe, expect, test } from "vitest";
import { resolveCoachPlacement } from "/Users/mini/incrementum-tauri/src/components/onboarding/tour/placement";

describe("placement regression: bottom-nav anchor", () => {
  // Simulate a mobile viewport with the queue button near the bottom edge.
  const vh = 800;
  const vw = 400;
  const coach = { width: 320, height: 220 };

  test("anchor near bottom flips from 'bottom' to 'top' instead of going off-screen", () => {
    // Bottom-nav button at y=740, height=40 → rect.bottom = 780
    const rect = { top: 740, left: 100, width: 60, height: 40, right: 160, bottom: 780 };
    const res = resolveCoachPlacement("bottom", rect, coach, { width: vw, height: vh });
    // The coach must be fully on-screen.
    expect(res.top).toBeGreaterThanOrEqual(12);
    expect(res.top + coach.height).toBeLessThanOrEqual(vh - 12);
    expect(res.left).toBeGreaterThanOrEqual(12);
    expect(res.left + coach.width).toBeLessThanOrEqual(vw - 12);
    // And it should have flipped to 'top' (above the anchor), not stayed 'bottom'.
    expect(res.side).toBe("top");
  });

  test("anchor near right edge picks a placement that fits horizontally", () => {
    const rect = { top: 400, left: 380, width: 20, height: 40, right: 400, bottom: 440 };
    const res = resolveCoachPlacement("right", rect, coach, { width: vw, height: vh });
    expect(res.left + coach.width).toBeLessThanOrEqual(vw - 12);
  });
});
