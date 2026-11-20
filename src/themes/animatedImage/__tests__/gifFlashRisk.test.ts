import { describe, expect, it } from "vitest";
import { hasHighFlashRisk } from "../gifFlashRisk";

function solid(red: number, green: number, blue: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = 255;
  }
  return pixels;
}

describe("GIF flash risk sampling", () => {
  it("blocks repeated red and high-luminance transitions, including the loop seam", () => {
    const black = solid(0, 0, 0);
    const white = solid(255, 255, 255);
    expect(hasHighFlashRisk([
      { pixels: black, timeMs: 0 },
      { pixels: white, timeMs: 200 },
      { pixels: black, timeMs: 400 },
      { pixels: white, timeMs: 600 },
    ], 800)).toBe(true);

    const red = solid(255, 0, 0);
    const green = solid(0, 255, 0);
    expect(hasHighFlashRisk([
      { pixels: red, timeMs: 0 },
      { pixels: green, timeMs: 200 },
      { pixels: red, timeMs: 400 },
    ], 600)).toBe(true);
  });

  it("allows ordinary low-contrast color movement and a single brief change", () => {
    const slate = solid(40, 48, 60);
    const steel = solid(58, 70, 86);
    expect(hasHighFlashRisk([
      { pixels: slate, timeMs: 0 },
      { pixels: steel, timeMs: 250 },
      { pixels: slate, timeMs: 500 },
      { pixels: steel, timeMs: 750 },
    ], 1_000)).toBe(false);

    expect(hasHighFlashRisk([
      { pixels: solid(0, 0, 0), timeMs: 0 },
      { pixels: solid(255, 255, 255), timeMs: 400 },
    ], 800)).toBe(false);
  });

  it("allows small changes in warm highlights across the former red cutoff", () => {
    const amber = solid(159, 80, 5);
    const brighterAmber = solid(161, 81, 5);
    expect(hasHighFlashRisk([
      { pixels: amber, timeMs: 0 },
      { pixels: brighterAmber, timeMs: 180 },
      { pixels: amber, timeMs: 360 },
      { pixels: brighterAmber, timeMs: 540 },
    ], 720)).toBe(false);
  });

  it("still blocks repeated bright red flashes against black", () => {
    const black = solid(0, 0, 0);
    const red = solid(255, 0, 0);
    expect(hasHighFlashRisk([
      { pixels: black, timeMs: 0 },
      { pixels: red, timeMs: 180 },
      { pixels: black, timeMs: 360 },
      { pixels: red, timeMs: 540 },
    ], 720)).toBe(true);
  });
});
