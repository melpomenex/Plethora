import { describe, expect, it } from "vitest";

// Pure math helper mimicking the fade-out volume multiplier logic inside AudiobookViewer
function calculateFadeVolume(
  currentTimeLeftMs: number,
  fadeDurationMs: number,
  baseVolume: number
): number {
  if (currentTimeLeftMs <= 0) return 0;
  if (currentTimeLeftMs >= fadeDurationMs) return baseVolume;
  const factor = currentTimeLeftMs / fadeDurationMs;
  return baseVolume * factor;
}

describe("Sleep Timer fade-out mathematics", () => {
  it("keeps the full volume when time left is larger than the fade-out threshold (5 seconds)", () => {
    const baseVolume = 0.8;
    const fadeThresholdMs = 5000;
    
    // 6 seconds left
    expect(calculateFadeVolume(6000, fadeThresholdMs, baseVolume)).toBe(0.8);
    // 10 seconds left
    expect(calculateFadeVolume(10000, fadeThresholdMs, baseVolume)).toBe(0.8);
  });

  it("scales volume down proportionally over the last 5 seconds", () => {
    const baseVolume = 0.8;
    const fadeThresholdMs = 5000;

    // 2.5 seconds left (exactly halfway)
    expect(calculateFadeVolume(2500, fadeThresholdMs, baseVolume)).toBeCloseTo(0.4);
    
    // 1.25 seconds left (quarter way)
    expect(calculateFadeVolume(1250, fadeThresholdMs, baseVolume)).toBeCloseTo(0.2);

    // 0.5 seconds left
    expect(calculateFadeVolume(500, fadeThresholdMs, baseVolume)).toBeCloseTo(0.08);
  });

  it("returns exactly 0 when the timer hits 0 or negative values", () => {
    const baseVolume = 0.8;
    const fadeThresholdMs = 5000;

    expect(calculateFadeVolume(0, fadeThresholdMs, baseVolume)).toBe(0);
    expect(calculateFadeVolume(-100, fadeThresholdMs, baseVolume)).toBe(0);
  });
});
