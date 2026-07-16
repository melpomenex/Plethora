import { describe, expect, it } from "vitest";
import { formatRelativeTime, normalizeUnixTimestampMs } from "../relativeTime";

describe("relative time utilities", () => {
  const nowMs = Date.UTC(2026, 6, 16, 12, 0, 0);

  it("normalizes Unix seconds while preserving millisecond timestamps", () => {
    const seconds = Math.floor(nowMs / 1000);

    expect(normalizeUnixTimestampMs(seconds)).toBe(nowMs);
    expect(normalizeUnixTimestampMs(nowMs)).toBe(nowMs);
  });

  it("formats normalized backend timestamps as recent values", () => {
    const seconds = Math.floor((nowMs - 30_000) / 1000);
    const twoDaysAgoSeconds = Math.floor((nowMs - 2 * 86_400_000) / 1000);

    expect(formatRelativeTime(normalizeUnixTimestampMs(seconds), nowMs)).toBe("just now");
    expect(formatRelativeTime(normalizeUnixTimestampMs(twoDaysAgoSeconds), nowMs)).toBe("2d ago");
    expect(formatRelativeTime(nowMs - 5 * 60_000, nowMs)).toBe("5m ago");
    expect(formatRelativeTime(nowMs - 2 * 86_400_000, nowMs)).toBe("2d ago");
  });

  it("uses a safe placeholder for invalid timestamps", () => {
    expect(formatRelativeTime(undefined, nowMs)).toBe("—");
    expect(formatRelativeTime(Number.NaN, nowMs)).toBe("—");
    expect(formatRelativeTime(Number.POSITIVE_INFINITY, nowMs)).toBe("—");
    expect(formatRelativeTime(0, nowMs)).toBe("—");
    expect(normalizeUnixTimestampMs(0)).toBeNull();
  });
});
