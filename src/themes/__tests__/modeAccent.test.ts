import { describe, expect, it } from "vitest";
import type { Theme } from "../../types/theme";
import { builtInThemes } from "../builtin";
import { contrastRatio, flattenOverBase, hueSeparation, parseColor, rgbToOklch } from "../color";
import { resolveModeAccent } from "../modeAccent";

/** Minimal valid theme with overridable colors, for resolver unit tests. */
function makeTheme(overrides: Partial<Theme["colors"]> & { variant?: "light" | "dark" }): Theme {
  const { variant, ...colorOverrides } = overrides;
  return {
    id: "test-theme",
    name: "Test Theme",
    variant: variant ?? "dark",
    colors: {
      background: "#12141a",
      onBackground: "#f5f7fb",
      surface: "#1c2027",
      onSurface: "#f5f7fb",
      surfaceVariant: "#262b34",
      primary: "#2f86d9",
      onPrimary: "#ffffff",
      primaryContainer: "#1f4f78",
      onPrimaryContainer: "#e3f0ff",
      secondary: "#5c646f",
      onSecondary: "#f5f7fb",
      outline: "#4b5664",
      outlineVariant: "#39414c",
      error: "#f66d6d",
      onError: "#ffffff",
      errorContainer: "#7a2828",
      onErrorContainer: "#ffcaca",
      success: "#6ae0c4",
      warning: "#ffca3a",
      toolbar: "#171a20",
      sidebar: "#101318",
      card: "#1c2027",
      input: "#1c2027",
      border: "#4b5664",
      text: "#f5f7fb",
      textSecondary: "#c8d0da",
      link: "#7ab4ff",
      ...colorOverrides,
    },
    typography: {
      fontFamily: "system-ui",
      fontSize: { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem" },
      fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
      lineHeight: { tight: 1.25, normal: 1.5, relaxed: 1.75 },
    },
    spacing: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2rem", "2xl": "3rem", "3xl": "4rem" },
    radius: { none: "0", sm: "0.125rem", md: "0.25rem", lg: "0.5rem", xl: "0.75rem", "2xl": "1rem", full: "9999px" },
    shadows: { sm: "none", md: "none", lg: "none", xl: "none" },
  };
}

function flatten(theme: Theme, value: string | undefined) {
  const parsed = parseColor(value);
  if (!parsed) return null;
  const bg = parseColor(theme.colors.background);
  const base = bg ? { r: bg.r, g: bg.g, b: bg.b } : { r: 18, g: 20, b: 26 };
  return parsed.a >= 1 ? { r: parsed.r, g: parsed.g, b: parsed.b } : flattenOverBase(parsed, base);
}

function surfaceOf(theme: Theme) {
  return flatten(theme, theme.colors.toolbar) ?? flatten(theme, theme.colors.card) ?? { r: 18, g: 20, b: 26 };
}

describe("resolveModeAccent — precedence chain", () => {
  it("prefers an explicit modeAccent and preserves its hue intent", () => {
    const theme = makeTheme({ modeAccent: "#e05a4e" }); // red-orange
    const { accent } = resolveModeAccent(theme);
    const accentHue = rgbToOklch(parseColor(accent)!).h;
    expect(hueSeparation(accentHue, 12)).toBeLessThan(30); // stays in the red family
  });

  it("still clamps an explicit modeAccent that would be unreadable", () => {
    // Near-black explicit accent on a dark theme must be lifted into the
    // readable band while keeping its hue.
    const theme = makeTheme({ modeAccent: "#101010" });
    const { accent } = resolveModeAccent(theme);
    const oklch = rgbToOklch(parseColor(accent)!);
    expect(oklch.l).toBeGreaterThanOrEqual(0.5);
  });

  it("falls back to a palette candidate when no explicit accent exists", () => {
    // warning (#ffca3a, hue ~85) is far from the blue primary (~210).
    const theme = makeTheme({});
    const { accent } = resolveModeAccent(theme);
    const hue = rgbToOklch(parseColor(accent)!).h;
    const primaryHue = rgbToOklch(parseColor("#2f86d9")!).h;
    expect(hueSeparation(hue, primaryHue)).toBeGreaterThanOrEqual(60);
  });

  it("synthesizes a rotated hue when every candidate fails scoring", () => {
    // All candidates are near-duplicates of the primary hue.
    const theme = makeTheme({
      secondary: "#2f86d9",
      link: "#3a90e4",
      success: "#256fb3",
      warning: "#4aa0dd",
    });
    const { accent } = resolveModeAccent(theme);
    const hue = rgbToOklch(parseColor(accent)!).h;
    const primaryHue = rgbToOklch(parseColor("#2f86d9")!).h;
    expect(hueSeparation(hue, primaryHue)).toBeGreaterThanOrEqual(60);
  });

  it("returns the global default when the palette is unparseable", () => {
    const corrupt = makeTheme({ primary: "not-a-color", background: "nope", toolbar: "junk" });
    const resolved = resolveModeAccent(corrupt);
    expect(resolved.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(resolved.foreground).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("takes the neutral path for monochrome palettes instead of inventing a hue", () => {
    const theme = makeTheme({
      primary: "#4a5568",
      secondary: "#2d3748",
      link: "#8a94a3",
      success: "#6b7482",
      warning: "#7d8794",
      onSurface: "#e8ecf1",
      text: "#e8ecf1",
    });
    const { accent } = resolveModeAccent(theme);
    const chroma = rgbToOklch(parseColor(accent)!).c;
    expect(chroma).toBeLessThan(0.04);
    // Neutral path still guarantees legibility against the surface.
    const surface = surfaceOf(theme);
    expect(contrastRatio(parseColor(accent)!, surface)).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic across repeated runs", () => {
    const theme = makeTheme({});
    const first = resolveModeAccent(theme);
    for (let i = 0; i < 5; i += 1) {
      expect(resolveModeAccent(theme)).toEqual(first);
    }
  });

  it("emits hex strings only (never oklch()/rgb()/color-mix)", () => {
    const resolved = resolveModeAccent(makeTheme({}));
    expect(resolved.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(resolved.foreground).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("resolveModeAccent — catalog-wide gate", () => {
  // The catalog is 48 modern themes plus the converted legacy index; guard
  // against silently iterating an empty or truncated registry.
  it("covers the full modern + legacy catalog", () => {
    expect(builtInThemes.length).toBeGreaterThanOrEqual(169);
    const ids = new Set(builtInThemes.map((t) => t.id));
    expect(ids.size).toBe(builtInThemes.length);
  });

  it("every built-in theme resolves to parseable, distinct, contrast-safe values", () => {
    const failures: string[] = [];

    for (const theme of builtInThemes) {
      const resolved = resolveModeAccent(theme);
      const accent = parseColor(resolved.accent);
      const foreground = parseColor(resolved.foreground);

      if (!accent || !foreground) {
        failures.push(`${theme.id}: unparseable output ${JSON.stringify(resolved)}`);
        continue;
      }

      const accentRgb = { r: accent.r, g: accent.g, b: accent.b };
      const surface = surfaceOf(theme);
      const blend = flattenOverBase({ ...accentRgb, a: 0.12 }, surface);

      const vsSurface = contrastRatio(accentRgb, surface);
      const vsBlend = contrastRatio(accentRgb, blend);
      const fgVsAccent = contrastRatio({ r: foreground.r, g: foreground.g, b: foreground.b }, accentRgb);

      const primary = flatten(theme, theme.colors.primary)!;
      const hueSep = hueSeparation(rgbToOklch(accentRgb).h, rgbToOklch(primary).h);

      const candidatesMonochrome = ["secondary", "link", "success", "warning", "primary"].every(
        (key) => {
          const flat = flatten(theme, theme.colors[key as keyof Theme["colors"]] as string);
          return !flat || rgbToOklch(flat).c < 0.04;
        }
      );

      if (vsSurface < 3) failures.push(`${theme.id}: surface contrast ${vsSurface.toFixed(2)} < 3`);
      if (vsBlend < 3) failures.push(`${theme.id}: tint-blend contrast ${vsBlend.toFixed(2)} < 3`);
      if (fgVsAccent < 4.5) failures.push(`${theme.id}: foreground contrast ${fgVsAccent.toFixed(2)} < 4.5`);
      if (hueSep < 60 && !candidatesMonochrome) {
        failures.push(`${theme.id}: hue separation ${hueSep.toFixed(0)}° < 60°`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("resolves identically on repeated catalog runs (determinism)", () => {
    for (const theme of builtInThemes.slice(0, 25)) {
      expect(resolveModeAccent(theme)).toEqual(resolveModeAccent(theme));
    }
  });
});
