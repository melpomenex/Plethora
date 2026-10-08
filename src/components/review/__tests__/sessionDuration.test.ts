import { describe, expect, it } from "vitest";
import { formatSessionDuration } from "../sessionDuration";

describe("formatSessionDuration", () => {
  it("renders sub-minute sessions in seconds, never bare 0m", () => {
    expect(formatSessionDuration(0)).toBe("0s");
    expect(formatSessionDuration(-500)).toBe("0s");
    expect(formatSessionDuration(Number.NaN)).toBe("0s");
    expect(formatSessionDuration(3_300)).toBe("3s");
    expect(formatSessionDuration(45_000)).toBe("45s");
    expect(formatSessionDuration(59_999)).toBe("59s");
  });

  it("renders minute-range sessions as Mm Ss, omitting zero seconds", () => {
    expect(formatSessionDuration(60_000)).toBe("1m");
    expect(formatSessionDuration(200_000)).toBe("3m 20s");
    expect(formatSessionDuration(240_000)).toBe("4m");
    expect(formatSessionDuration(3_599_999)).toBe("59m 59s");
  });

  it("renders hour-range sessions as Hh Mm, omitting zero minutes", () => {
    expect(formatSessionDuration(3_600_000)).toBe("1h");
    expect(formatSessionDuration(3_900_000)).toBe("1h 5m");
    expect(formatSessionDuration(7_200_000)).toBe("2h");
  });

  it("keeps the per-card average consistent with the duration tile", () => {
    // 13 cards in ~3 minutes of real time: the reported bug showed "0m" / "0s per card".
    const durationMs = 200_000;
    const reviewsCompleted = 13;
    expect(formatSessionDuration(durationMs)).toBe("3m 20s");
    expect(Math.round(durationMs / 1000 / reviewsCompleted)).toBe(15);
  });
});
