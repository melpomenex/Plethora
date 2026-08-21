import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  flattenOverBase,
  hueSeparation,
  makeOpaque,
  mirrorIntoBand,
  normalizeHue,
  oklchToRgb,
  parseColor,
  relativeLuminance,
  rgbToHex,
  rgbToOklch,
  shortestHueDelta,
} from "../color";

interface OklchFixture {
  hex: string;
  l: number;
  c: number;
  h: number;
}

// Reference values from Björn Ottosson's OkLab publication and the CSS Color 4
// conversion examples.
const OKLCH_FIXTURES: OklchFixture[] = [
  { hex: "#ffffff", l: 1.0, c: 0.0, h: 0 },
  { hex: "#000000", l: 0.0, c: 0.0, h: 0 },
  { hex: "#ff0000", l: 0.628, c: 0.2577, h: 29.23 },
  { hex: "#00ff00", l: 0.8664, c: 0.2948, h: 142.5 },
  { hex: "#0000ff", l: 0.452, c: 0.3132, h: 264.05 },
  { hex: "#808080", l: 0.5999, c: 0.0, h: 0 },
];

describe("parseColor", () => {
  it.each([
    ["#000000", { r: 0, g: 0, b: 0, a: 1 }],
    ["#ffffff", { r: 255, g: 255, b: 255, a: 1 }],
    ["#abc", { r: 0xaa, g: 0xbb, b: 0xcc, a: 1 }],
    ["#abcd", { r: 0xaa, g: 0xbb, b: 0xcc, a: 0xdd / 255 }],
    ["#ff8800", { r: 255, g: 136, b: 0, a: 1 }],
    ["#ff880080", { r: 255, g: 136, b: 0, a: 0x80 / 255 }],
    ["rgb(1, 2, 3)", { r: 1, g: 2, b: 3, a: 1 }],
    ["rgb(1 2 3)", { r: 1, g: 2, b: 3, a: 1 }],
    ["rgba(10, 20, 30, 0.5)", { r: 10, g: 20, b: 30, a: 0.5 }],
    ["rgba( 10 ,20 , 30 , 0.25 )", { r: 10, g: 20, b: 30, a: 0.25 }],
    ["rgba(10 20 30 / 0.75)", { r: 10, g: 20, b: 30, a: 0.75 }],
    ["rgb(50%, 100%, 0%)", { r: 127.5, g: 255, b: 0, a: 1 }],
    ["  #FF8800  ", { r: 255, g: 136, b: 0, a: 1 }],
  ])("parses %s", (input, expected) => {
    expect(parseColor(input)).toEqual(expected);
  });

  it.each([
    "",
    undefined,
    null,
    "not-a-color",
    "#ff",
    "#fffffff",
    "rgb()",
    "rgb(1, 2)",
    "rgb(a, b, c)",
    "hsl(120, 50%, 50%)",
    "named-color",
  ])("rejects %s", (input) => {
    expect(parseColor(input as string)).toBeNull();
  });
});

describe("flattenOverBase", () => {
  it("keeps a fully opaque color unchanged", () => {
    expect(flattenOverBase({ r: 10, g: 20, b: 30, a: 1 }, { r: 255, g: 255, b: 255 })).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });

  it("returns the base for a fully transparent color", () => {
    expect(flattenOverBase({ r: 10, g: 20, b: 30, a: 0 }, { r: 200, g: 100, b: 50 })).toEqual({
      r: 200,
      g: 100,
      b: 50,
    });
  });

  it("composites alpha linearly", () => {
    const out = flattenOverBase({ r: 255, g: 0, b: 0, a: 0.5 }, { r: 0, g: 0, b: 255 });
    expect(out.r).toBeCloseTo(127.5, 1);
    expect(out.g).toBeCloseTo(0, 1);
    expect(out.b).toBeCloseTo(127.5, 1);
  });
});

describe("makeOpaque", () => {
  it.each([
    ["rgba(1, 2, 3, 0.5)", "rgb(1, 2, 3)"],
    ["#11223344", "#112233"],
    ["#1234", "#123"],
    ["#112233", "#112233"],
    ["red", "red"],
  ])("strips alpha from %s", (input, expected) => {
    expect(makeOpaque(input)).toBe(expected);
  });

  it("falls back for missing colors", () => {
    expect(makeOpaque(undefined)).toBe("#1e293b");
    expect(makeOpaque(undefined, "#ffffff")).toBe("#ffffff");
    expect(makeOpaque("", "#abcdef")).toBe("#abcdef");
  });
});

describe("rgbToOklch / oklchToRgb", () => {
  it.each(OKLCH_FIXTURES)("converts $hex to OKLCH", ({ hex, l, c, h }) => {
    const rgb = parseColor(hex)!;
    const oklch = rgbToOklch(rgb);
    expect(oklch.l).toBeCloseTo(l, 3);
    expect(oklch.c).toBeCloseTo(c, 3);
    // Hue is meaningless at zero chroma; only compare for chromatic colors.
    if (c > 0) {
      expect(oklch.h).toBeCloseTo(h, 1);
    }
  });

  it.each(OKLCH_FIXTURES)("round-trips $hex through OKLCH exactly", ({ hex }) => {
    const rgb = parseColor(hex)!;
    const back = rgbToHex(oklchToRgb(rgbToOklch(rgb)));
    expect(back).toBe(hex.toLowerCase());
  });

  it("keeps round-trip error within one quantization step across a sample grid", () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const back = rgbToHex(oklchToRgb(rgbToOklch({ r, g, b })));
          const parsed = parseColor(back)!;
          expect(Math.abs(parsed.r - r)).toBeLessThanOrEqual(1);
          expect(Math.abs(parsed.g - g)).toBeLessThanOrEqual(1);
          expect(Math.abs(parsed.b - b)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("clamps out-of-gamut OKLCH input into sRGB", () => {
    const rgb = oklchToRgb({ l: 0.5, c: 0.4, h: 30 });
    expect(rgb.r).toBeGreaterThanOrEqual(0);
    expect(rgb.r).toBeLessThanOrEqual(255);
    expect(rgb.g).toBeGreaterThanOrEqual(0);
    expect(rgb.g).toBeLessThanOrEqual(255);
    expect(rgb.b).toBeGreaterThanOrEqual(0);
    expect(rgb.b).toBeLessThanOrEqual(255);
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it.each([
    [{ r: 0, g: 0, b: 0 }, 0],
    [{ r: 255, g: 255, b: 255 }, 1],
    [{ r: 255, g: 0, b: 0 }, 0.2126],
  ])("computes relative luminance of %j as %f", (rgb, expected) => {
    expect(relativeLuminance(rgb)).toBeCloseTo(expected, 4);
  });

  it.each([
    ["#000000", "#ffffff", 21],
    ["#ffffff", "#000000", 21],
    ["#ffffff", "#ffffff", 1],
    ["#ffffff", "#777777", 4.478],
    ["#ffffff", "#ff0000", 3.998],
    ["#777777", "#000000", (0.1845 + 0.05) / 0.05],
  ])("contrast of %s vs %s is %f", (aHex, bHex, expected) => {
    const a = parseColor(aHex)!;
    const b = parseColor(bHex)!;
    expect(contrastRatio(a, b)).toBeCloseTo(expected, 2);
  });

  it("is symmetric and order-independent", () => {
    const a = parseColor("#22d3ee")!;
    const b = parseColor("#121426")!;
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe("hue helpers", () => {
  it.each([
    [0, 90, 90],
    [350, 10, 20],
    [10, 350, 20],
    [0, 180, 180],
    [0, 0, 0],
    [120, 300, 180],
  ])("hueSeparation(%f, %f) = %f", (a, b, expected) => {
    expect(hueSeparation(a, b)).toBeCloseTo(expected, 6);
  });

  it.each([
    [-30, 330],
    [390, 30],
    [0, 0],
    [720, 0],
  ])("normalizeHue(%f) = %f", (input, expected) => {
    expect(normalizeHue(input)).toBeCloseTo(expected, 6);
  });

  it.each([
    [0, 30, 30],
    [0, -30, -30],
    [0, 190, -170],
    [10, 350, -20],
  ])("shortestHueDelta(%f -> %f) = %f", (from, to, expected) => {
    expect(shortestHueDelta(from, to)).toBeCloseTo(expected, 6);
  });
});

describe("mirrorIntoBand", () => {
  it("reflects values below the band off the lower edge", () => {
    expect(mirrorIntoBand(0.45, 0.55, 0.85)).toBeCloseTo(0.65, 6);
    expect(mirrorIntoBand(0.2, 0.55, 0.85)).toBeCloseTo(0.85, 6);
  });

  it("clamps values above the band to the upper edge", () => {
    expect(mirrorIntoBand(0.9, 0.55, 0.85)).toBeCloseTo(0.85, 6);
  });

  it("keeps in-band values unchanged", () => {
    expect(mirrorIntoBand(0.7, 0.55, 0.85)).toBeCloseTo(0.7, 6);
  });
});
