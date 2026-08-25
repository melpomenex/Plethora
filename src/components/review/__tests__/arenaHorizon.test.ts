import { describe, expect, it } from "vitest";
import {
  clampCustomInterval,
  groupHorizonCollisions,
  horizonDaysAt,
  horizonPosition,
  horizonTicks,
} from "../arenaHorizon";

describe("Memory Horizon math", () => {
  it("round-trips sub-day through multi-year intervals on a log domain", () => {
    for (const days of [1 / 1_440, 0.25, 1, 7, 365.25, 12_000]) {
      const position = horizonPosition(days, 44_530);
      expect(horizonDaysAt(position, 44_530)).toBeCloseTo(days, 8);
    }
  });

  it("clamps custom values and handles non-finite input", () => {
    expect(clampCustomInterval(-1, 0.1, 100)).toBe(0.1);
    expect(clampCustomInterval(300, 0.1, 100)).toBe(100);
    expect(clampCustomInterval(Number.NaN, 0.1, 100)).toBe(0.1);
  });

  it("generates ordered natural ticks across extreme ranges", () => {
    const ticks = horizonTicks(44_530, 7);
    expect(ticks.at(-1)).toBe(44_530);
    expect(ticks.every((tick, index) => index === 0 || tick > ticks[index - 1])).toBe(true);
  });

  it("groups equal and near-overlapping markers deterministically", () => {
    const points = [
      { id: "m5", intervalDays: 30 },
      { id: "m4", intervalDays: 30 },
      { id: "m1", intervalDays: 3 },
    ];
    const first = groupHorizonCollisions(points, 60);
    const second = groupHorizonCollisions([...points].reverse(), 60);
    expect(first).toEqual(second);
    expect(first.find((cluster) => cluster.points.length === 2)?.points.map((point) => point.id)).toEqual(["m4", "m5"]);
  });
});
