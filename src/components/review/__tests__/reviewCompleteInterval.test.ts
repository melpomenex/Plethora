import { describe, expect, it } from "vitest";
import { formatArenaInterval } from "../arenaFormatters";

/**
 * Review Complete "Scheduled" line (review-complete-summary spec):
 * the last graded card's intervalDays (a float in days) must render as a
 * human interval, never as a raw fractional-day float.
 */
describe("Review Complete next-review interval", () => {
  it("renders a failed Again step as minutes, not a raw float", () => {
    const rendered = formatArenaInterval(0.00003827570253633894, "en");
    expect(rendered).toBe("1 min");
    expect(rendered).not.toContain("0.000038");
  });

  it("renders a passed Good interval as whole days", () => {
    expect(formatArenaInterval(3.2, "en")).toBe("3 days");
  });

  it("renders hour-range relearning steps as hours", () => {
    expect(formatArenaInterval(2 / 24, "en")).toBe("2 hr");
  });

  it("never leaks a raw float for degenerate input", () => {
    for (const days of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const rendered = formatArenaInterval(days, "en");
      expect(rendered).not.toMatch(/\d+\.\d{4,}/);
    }
  });
});
