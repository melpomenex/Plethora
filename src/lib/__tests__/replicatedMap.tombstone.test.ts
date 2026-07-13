import { describe, expect, it } from "vitest";
import { compareClock } from "../sync/syncClock";

describe("tombstone conflict ordering", () => {
  it("treats an older offline live update as unable to resurrect a delete", () => {
    expect(compareClock("1000.000001", "1000.000002")).toBeLessThanOrEqual(0);
  });

  it("allows an explicit newer recreation", () => {
    expect(compareClock("1000.000003", "1000.000002")).toBeGreaterThan(0);
  });
});
