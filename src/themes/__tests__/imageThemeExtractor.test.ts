import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "../color";
import {
  extractPaletteFromPixels,
  extractPaletteFromWeightedSamples,
  getMoodDefaults,
  synthesizeThemeFromPalette,
} from "../imageThemeExtractor";
import { obsidianNoirTheme } from "../fallback";

function makeSolidAndAccentPixels(
  width: number,
  height: number,
  bg: [number, number, number],
  accent: [number, number, number],
  accentRatio: number
): Uint8ClampedArray {
  const total = width * height;
  const accentCount = Math.floor(total * accentRatio);
  const data = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    const [r, g, b] = i < accentCount ? accent : bg;
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("imageThemeExtractor", () => {
  it("extracts vivid accent even when background dominates 80% of the image", () => {
    // 80% deep navy (#10182b) + 20% vivid coral (#ff5e3a)
    const pixels = makeSolidAndAccentPixels(64, 64, [16, 24, 43], [255, 94, 58], 0.2);
    const palette = extractPaletteFromPixels(pixels, 64, 64);

    expect(palette.suggestedVariant).toBe("dark");
    expect(palette.swatches.length).toBeGreaterThanOrEqual(2);
    // Primary should be vibrant (chroma > 0.1) rather than washed-out navy
    expect(palette.primary.c).toBeGreaterThan(0.1);
  });

  it("suggests light variant for bright images", () => {
    const pixels = makeSolidAndAccentPixels(48, 48, [242, 240, 234], [56, 120, 210], 0.15);
    const palette = extractPaletteFromPixels(pixels, 48, 48);

    expect(palette.suggestedVariant).toBe("light");
    expect(palette.medianLightness).toBeGreaterThan(0.62);
  });

  it("weights animated samples by duration and visible alpha", () => {
    const blue = makeSolidAndAccentPixels(4, 4, [0, 0, 255], [0, 0, 255], 0);
    const green = makeSolidAndAccentPixels(4, 4, [0, 255, 0], [0, 255, 0], 0);
    const palette = extractPaletteFromWeightedSamples([
      { pixels: blue, width: 4, height: 4, weightMs: 100 },
      { pixels: green, width: 4, height: 4, weightMs: 900 },
    ]);

    expect(palette.atmosphere.h).toBeGreaterThan(115);
    expect(palette.atmosphere.h).toBeLessThan(145);

    const transparency = new Uint8ClampedArray([
      255, 0, 255, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const alphaPalette = extractPaletteFromWeightedSamples([
      { pixels: transparency, width: 2, height: 2, weightMs: 100 },
    ]);
    expect(alphaPalette.atmosphere.h).toBeGreaterThan(290);
    expect(alphaPalette.atmosphere.h).toBeLessThan(335);
  });

  it("does not promote a sub-two-percent chromatic flash to a theme swatch", () => {
    const stableBlue = makeSolidAndAccentPixels(10, 10, [0, 0, 255], [0, 0, 255], 0);
    const flashRed = makeSolidAndAccentPixels(10, 10, [255, 0, 0], [255, 0, 0], 0);
    const palette = extractPaletteFromWeightedSamples([
      { pixels: stableBlue, width: 10, height: 10, weightMs: 9_801 },
      { pixels: flashRed, width: 10, height: 10, weightMs: 199 },
    ]);

    expect(palette.swatches.some((swatch) => swatch.oklch.h < 30 || swatch.oklch.h > 330)).toBe(false);
    expect(palette.primary.h).toBeGreaterThan(220);
  });

  it("synthesizes WCAG AA compliant themes across moods and variants", () => {
    const pixels = makeSolidAndAccentPixels(48, 48, [18, 22, 34], [64, 210, 175], 0.25);
    const palette = extractPaletteFromPixels(pixels, 48, 48);
    const baseTokens = {
      typography: obsidianNoirTheme.typography,
      spacing: obsidianNoirTheme.spacing,
      radius: obsidianNoirTheme.radius,
      shadows: obsidianNoirTheme.shadows,
    };

    for (const variant of ["dark", "light"] as const) {
      for (const mood of ["vibrant", "editorial", "deep-glass", "high-contrast"] as const) {
        const theme = synthesizeThemeFromPalette(palette, {
          name: `Test ${mood}`,
          variant,
          mood,
          backgroundImage: {
            imageId: "img-test",
            ...getMoodDefaults(mood),
          },
          baseTokens,
        });

        const bg = parseColor(theme.colors.background)!;
        const onBg = parseColor(theme.colors.onBackground)!;
        const surf = parseColor(theme.colors.surface)!;
        const onSurf = parseColor(theme.colors.onSurface)!;
        const minFloor = mood === "high-contrast" ? 7.0 : 4.5;

        expect(contrastRatio(onBg, bg)).toBeGreaterThanOrEqual(minFloor);
        expect(contrastRatio(onSurf, surf)).toBeGreaterThanOrEqual(minFloor);
        expect(theme.effects?.backgroundImage?.imageId).toBe("img-test");
      }
    }
  });

  it("keeps text, links, controls, and focus colors readable for extreme accent overrides", () => {
    const pixels = makeSolidAndAccentPixels(48, 48, [18, 22, 34], [64, 210, 175], 0.25);
    const palette = extractPaletteFromPixels(pixels, 48, 48);
    const baseTokens = {
      typography: obsidianNoirTheme.typography,
      spacing: obsidianNoirTheme.spacing,
      radius: obsidianNoirTheme.radius,
      shadows: obsidianNoirTheme.shadows,
    };
    const accentOverrides = ["#ffffff", "#000000", "#ffff00", "#24aa44"];

    for (const variant of ["dark", "light"] as const) {
      for (const mood of ["vibrant", "editorial", "deep-glass", "high-contrast"] as const) {
        for (const primaryOverride of accentOverrides) {
          const theme = synthesizeThemeFromPalette(palette, {
            name: `Contrast ${mood}`,
            variant,
            mood,
            primaryOverride,
            backgroundImage: { imageId: "img-contrast", ...getMoodDefaults(mood) },
            baseTokens,
          });
          const colors = theme.colors;
          const background = parseColor(colors.background)!;
          const surface = parseColor(colors.surface)!;
          const ratio = (foreground: string, backdrop: typeof surface) =>
            contrastRatio(parseColor(foreground)!, backdrop);
          const textFloor = mood === "high-contrast" ? 7 : 4.5;

          expect(ratio(colors.onBackground, background)).toBeGreaterThanOrEqual(textFloor);
          expect(ratio(colors.onSurface, surface)).toBeGreaterThanOrEqual(textFloor);
          expect(ratio(colors.textSecondary, surface)).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.link, surface)).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.primary, surface)).toBeGreaterThanOrEqual(3);
          expect(ratio(colors.primary, background)).toBeGreaterThanOrEqual(3);
          expect(ratio(colors.secondary, surface)).toBeGreaterThanOrEqual(3);
          expect(ratio(colors.tertiary, surface)).toBeGreaterThanOrEqual(3);
          expect(ratio(colors.outline, surface)).toBeGreaterThanOrEqual(3);
          expect(ratio(colors.border, surface)).toBeGreaterThanOrEqual(3);
          expect(ratio(colors.onPrimary, parseColor(colors.primary)!)).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.onPrimaryContainer, parseColor(colors.primaryContainer)!)).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.error, surface)).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.success, surface)).toBeGreaterThanOrEqual(4.5);
          expect(ratio(colors.warning, surface)).toBeGreaterThanOrEqual(4.5);
          expect(theme.effects?.backgroundImage?.protectedSurfaces).toBe(true);
        }
      }
    }
  });
});
