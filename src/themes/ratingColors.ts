import type { ThemeColors, ThemeVariant } from "../types/theme";
import { contrastRatio, flattenOverBase, parseColor, rgbToHex, type Rgb } from "./color";

/** Opaque tonal pairs keep imported palettes readable without requiring new theme fields. */
export function resolveRatingColors(colors: ThemeColors, variant: ThemeVariant, roles: Record<string, string>): Record<string, string> {
  const fallback = variant === "dark" ? "#202024" : "#f6f2fa";
  const surface = parseColor(colors.surfaceContainerHigh ?? roles["surface-container-high"] ?? colors.surface) ?? parseColor(fallback)!;
  const base = flattenOverBase(surface, parseColor(fallback)!);
  const preferred = parseColor(colors.onSurface);
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  const foreground = (background: Rgb) => {
    const candidate = preferred && flattenOverBase(preferred, background);
    if (candidate && contrastRatio(candidate, background) >= 4.5) return rgbToHex(candidate);
    return contrastRatio(white, background) >= 4.5 ? "#ffffff" : rgbToHex(black);
  };
  const pairs: Record<string, string> = { "rating-surface": rgbToHex(base), "on-rating-surface": foreground(base) };
  const accents = { again: colors.error, hard: colors.warning, good: colors.primary, easy: colors.success, dismiss: colors.outline };
  for (const [action, accent] of Object.entries(accents)) {
    const color = parseColor(accent) ?? base;
    const background = parseColor(rgbToHex(flattenOverBase({ ...color, a: 0.12 }, base)))!;
    pairs[`rating-${action}`] = rgbToHex(background);
    pairs[`on-rating-${action}`] = foreground(background);
  }
  return pairs;
}
