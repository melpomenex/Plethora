import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "../color";
import {
  extractPaletteFromPixels,
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
});
