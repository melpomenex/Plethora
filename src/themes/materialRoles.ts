/**
 * Material 3 semantic role derivation for the theme layer.
 *
 * Every Plethora theme (modern literals, compact legacy defs, jellyfish and
 * custom themes) carries a Material-3-shaped `ThemeColors` map, but only part
 * of the role set. This module derives the missing roles — container
 * hierarchy, secondary/tertiary containers, inverse roles, on-surface-variant,
 * scrim — from the fields every theme already defines, using the OKLCH color
 * math in `themes/color.ts`. Themes may override any derived role via the
 * optional `ThemeColors` keys; explicit values always win.
 *
 * Emitted values are opaque hex strings (repo convention: no oklch() or
 * color-mix() in theme values — see themes/color.ts header).
 */

import {
  contrastRatio,
  flattenOverBase,
  normalizeHue,
  oklchToRgb,
  parseColor,
  type Rgb,
  rgbToHex,
  rgbToOklch,
  type Oklch,
} from "./color";
import type { ThemeColors, ThemeVariant } from "../types/theme";

/** Full Material 3 role set as a flat kebab-key → hex map. */
export type MaterialRoleMap = Record<string, string>;

/** Roles this module can derive when the theme does not define them. */
const DERIVABLE_ROLES = [
  "on-surface-variant",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "inverse-surface",
  "on-inverse-surface",
  "inverse-primary",
  "scrim",
  "surface-tint",
] as const;

const DARK_BASE_FALLBACK = "#121426";
const LIGHT_BASE_FALLBACK = "#ffffff";

/** WCAG AA for body text — the floor every derived on-X/X pair is clamped to. */
const TEXT_CONTRAST_MIN = 4.5;

function clampL(l: number, min = 0.03, max = 0.985): number {
  return l < min ? min : l > max ? max : l;
}

/** Retone a color: same hue, adjusted lightness and scaled chroma. */
function tone(color: Rgb, l: number, chromaScale = 1): Rgb {
  const oklch = rgbToOklch(color);
  return oklchToRgb({ l: clampL(l), c: Math.max(0, oklch.c * chromaScale), h: oklch.h });
}

function toHex(rgb: Rgb): string {
  return rgbToHex(rgb);
}

function luminance(rgb: Rgb): number {
  // Cheap directional test only; contrastRatio does the real math.
  const { r, g, b } = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Enforce visible 8-bit separation between consecutive ramp steps after the
 * OKLCH→sRGB round trip. Near-black and near-white backgrounds quantize
 * small perceptual lightness steps away (L 0.03 vs L 0.042 both → #020202),
 * which would collapse tonal elevation; nudge channels apart instead.
 */
function enforceIntegerMonotonic(steps: Rgb[], dir: 1 | -1, minGap = 3): Rgb[] {
  const out: Rgb[] = [];
  for (const step of steps) {
    if (out.length === 0) {
      out.push(step);
      continue;
    }
    const prev = out[out.length - 1];
    const prevAvg = (prev.r + prev.g + prev.b) / 3;
    const curAvg = (step.r + step.g + step.b) / 3;
    const separated = dir > 0 ? curAvg >= prevAvg + minGap : curAvg <= prevAvg - minGap;
    if (separated) {
      out.push(step);
    } else {
      const anchor = dir > 0 ? Math.min(255, prevAvg + minGap + 1) : Math.max(0, prevAvg - minGap - 1);
      out.push({ r: Math.round(anchor), g: Math.round(anchor), b: Math.round(anchor) });
    }
  }
  return out;
}

/**
 * Shift the foreground's lightness away from the base until the pair reaches
 * `min` contrast (or lightness runs out). Returns the adjusted foreground.
 */
function ensureContrast(fg: Rgb, base: Rgb, min: number): Rgb {
  if (contrastRatio(fg, base) >= min) return fg;
  const fgOklch = rgbToOklch(fg);
  const goLighter = luminance(base) < 0.5;
  let best: Rgb = fg;
  let bestRatio = contrastRatio(fg, base);
  for (let step = 1; step <= 24; step++) {
    const l = goLighter
      ? clampL(fgOklch.l + step * 0.04)
      : clampL(fgOklch.l - step * 0.04);
    const candidate = oklchToRgb({ l, c: fgOklch.c, h: fgOklch.h });
    const ratio = contrastRatio(candidate, base);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= min) return candidate;
    if (l <= 0.03 || l >= 0.985) break;
  }
  return best;
}

/** Pair-derive a container and its on-color around the container's hue. */
function containerPair(
  hueSource: Rgb,
  containerL: number,
  onL: number,
  chromaScale = 0.7,
): { container: string; on: string } {
  const containerRgb = tone(hueSource, containerL, chromaScale);
  const onRgb = ensureContrast(tone(hueSource, onL, chromaScale), containerRgb, TEXT_CONTRAST_MIN);
  return { container: toHex(containerRgb), on: toHex(onRgb) };
}

interface NeutralRamp {
  lowest: Rgb;
  low: Rgb;
  base: Rgb;
  high: Rgb;
  highest: Rgb;
}

/**
 * Container hierarchy from the theme's background family. Dark variants ramp
 * lighter as surfaces rise; light variants ramp darker. Steps are strictly
 * monotonic with a minimum perceptual gap so tonal elevation is visible on
 * every theme, including near-flat legacy backgrounds.
 */
function neutralRamp(background: Rgb, variant: ThemeVariant): NeutralRamp {
  const { c, h } = rgbToOklch(background);
  // Neutral family: keep the background's hue but soften chroma so the ramp
  // reads as elevation, not as a color gradient.
  const nc = Math.min(c * 0.6, 0.012);
  const l = rgbToOklch(background).l;
  const at = (lightness: number) => oklchToRgb({ l: clampL(lightness), c: nc, h });

  if (variant === "dark") {
    const steps = enforceIntegerMonotonic(
      [at(l - 0.03), at(l), at(l + 0.025), at(l + 0.05), at(l + 0.075)],
      1,
    );
    return { lowest: steps[0], low: steps[1], base: steps[2], high: steps[3], highest: steps[4] };
  }

  // Light: highest is the most shaded, lowest is the brightest.
  const steps = enforceIntegerMonotonic(
    [at(l + 0.045), at(l + 0.02), at(l - 0.008), at(l - 0.035), at(l - 0.06)],
    -1,
  );
  return { lowest: steps[0], low: steps[1], base: steps[2], high: steps[3], highest: steps[4] };
}

function tertiaryHue(primary: Rgb): number {
  const oklch = rgbToOklch(primary);
  return normalizeHue(oklch.h + 60);
}

/**
 * Derive the missing Material 3 roles for a theme. Explicit optional keys on
 * `colors` (e.g. `tertiary`, `surfaceContainerHigh`) win over derivation and
 * are not re-derived.
 */
export function deriveMaterialRoles(colors: ThemeColors, variant: ThemeVariant): MaterialRoleMap {
  const fallback = variant === "dark" ? DARK_BASE_FALLBACK : LIGHT_BASE_FALLBACK;
  const parsed = (value: string | undefined): Rgb | null => {
    if (!value) return null;
    const rgba = parseColor(value);
    if (!rgba) return null;
    if (rgba.a >= 1) return rgba;
    return flattenOverBase(rgba, parseColor(fallback) ?? { r: 255, g: 255, b: 255 });
  };

  const background = parsed(colors.background) ?? parsed(colors.surface) ?? parseColor(fallback)!;
  const surface = parsed(colors.surface) ?? background;
  const primary = parsed(colors.primary) ?? background;
  const secondary = parsed(colors.secondary) ?? primary;

  const roles: MaterialRoleMap = {};
  const explicit: Record<string, string | undefined> = {
    "on-surface-variant": colors.onSurfaceVariant,
    "secondary-container": colors.secondaryContainer,
    "on-secondary-container": colors.onSecondaryContainer,
    tertiary: colors.tertiary,
    "on-tertiary": colors.onTertiary,
    "tertiary-container": colors.tertiaryContainer,
    "on-tertiary-container": colors.onTertiaryContainer,
    "surface-dim": colors.surfaceDim,
    "surface-bright": colors.surfaceBright,
    "surface-container-lowest": colors.surfaceContainerLowest,
    "surface-container-low": colors.surfaceContainerLow,
    "surface-container": colors.surfaceContainer,
    "surface-container-high": colors.surfaceContainerHigh,
    "surface-container-highest": colors.surfaceContainerHighest,
    "inverse-surface": colors.inverseSurface,
    "on-inverse-surface": colors.onInverseSurface,
    "inverse-primary": colors.inversePrimary,
  };

  const ramp = neutralRamp(background, variant);

  // --- on-surface-variant ---
  if (!explicit["on-surface-variant"]) {
    const fromText = parsed(colors.textSecondary);
    roles["on-surface-variant"] = fromText
      ? toHex(ensureContrast(fromText, surface, TEXT_CONTRAST_MIN))
      : toHex(tone(background, variant === "dark" ? 0.78 : 0.45));
  }

  // --- secondary container pair ---
  if (!explicit["secondary-container"] || !explicit["on-secondary-container"]) {
    const pair = containerPair(secondary, variant === "dark" ? 0.32 : 0.88, variant === "dark" ? 0.9 : 0.35);
    roles["secondary-container"] = explicit["secondary-container"] ?? pair.container;
    roles["on-secondary-container"] = explicit["on-secondary-container"] ?? pair.on;
  }

  // --- tertiary family: primary hue-rotated ~60° with reduced chroma ---
  const tertiaryRgb = parsed(colors.tertiary) ?? oklchToRgb({
    l: variant === "dark" ? 0.8 : 0.5,
    c: Math.min(rgbToOklch(primary).c * 0.55, 0.12),
    h: tertiaryHue(primary),
  });
  if (!explicit.tertiary) roles.tertiary = toHex(tertiaryRgb);
  if (!explicit["on-tertiary"]) {
    roles["on-tertiary"] = toHex(
      ensureContrast(
        tone(tertiaryRgb, variant === "dark" ? 0.16 : 0.98, 0.9),
        tertiaryRgb,
        TEXT_CONTRAST_MIN,
      ),
    );
  }
  if (!explicit["tertiary-container"] || !explicit["on-tertiary-container"]) {
    const pair = containerPair(tertiaryRgb, variant === "dark" ? 0.33 : 0.88, variant === "dark" ? 0.9 : 0.36);
    roles["tertiary-container"] = explicit["tertiary-container"] ?? pair.container;
    roles["on-tertiary-container"] = explicit["on-tertiary-container"] ?? pair.on;
  }

  // --- container hierarchy ---
  const assign = (role: string, rgb: Rgb) => {
    if (!explicit[role]) roles[role] = toHex(rgb);
  };
  assign("surface-container-lowest", ramp.lowest);
  assign("surface-container-low", ramp.low);
  assign("surface-container", ramp.base);
  assign("surface-container-high", ramp.high);
  assign("surface-container-highest", ramp.highest);

  // --- dim / bright ---
  if (!explicit["surface-dim"]) {
    roles["surface-dim"] = toHex(
      variant === "dark" ? ramp.lowest : tone(ramp.highest, rgbToOklch(ramp.highest).l - 0.03, 0.5),
    );
  }
  if (!explicit["surface-bright"]) {
    roles["surface-bright"] = toHex(
      variant === "dark" ? tone(ramp.highest, rgbToOklch(ramp.highest).l + 0.06, 0.5) : ramp.lowest,
    );
  }

  // --- inverse roles ---
  const inverseSurface = parsed(colors.inverseSurface) ?? tone(
    background,
    variant === "dark" ? 0.9 : 0.25,
    0.3,
  );
  if (!explicit["inverse-surface"]) roles["inverse-surface"] = toHex(inverseSurface);
  if (!explicit["on-inverse-surface"]) {
    roles["on-inverse-surface"] = toHex(
      ensureContrast(
        tone(background, variant === "dark" ? 0.12 : 0.96, 0.2),
        inverseSurface,
        TEXT_CONTRAST_MIN,
      ),
    );
  }
  if (!explicit["inverse-primary"]) {
    const inversePrimary = oklchToRgb({
      l: variant === "dark" ? 0.5 : 0.82,
      c: Math.min(rgbToOklch(primary).c, 0.14),
      h: rgbToOklch(primary).h,
    });
    roles["inverse-primary"] = toHex(ensureContrast(inversePrimary, inverseSurface, 3));
  }

  if (!colors.scrim) roles.scrim = "rgba(0, 0, 0, 0.42)";
  roles["surface-tint"] = toHex(primary);

  // Only derived (non-explicit) roles are returned; the caller writes them as
  // --color-<role> alongside the theme's own keys.
  return roles;
}

/** Roles every scheme (seed-generated or derived) must provide. */
export const REQUIRED_MATERIAL_ROLES = [
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
  "surface",
  "on-surface",
  "on-surface-variant",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "outline",
  "outline-variant",
  "inverse-surface",
  "on-inverse-surface",
  "inverse-primary",
  "scrim",
] as const;

export interface MaterialScheme {
  primary: string;
  "on-primary": string;
  "primary-container": string;
  "on-primary-container": string;
  secondary: string;
  "on-secondary": string;
  "secondary-container": string;
  "on-secondary-container": string;
  tertiary: string;
  "on-tertiary": string;
  "tertiary-container": string;
  "on-tertiary-container": string;
  error: string;
  "on-error": string;
  "error-container": string;
  "on-error-container": string;
  surface: string;
  "on-surface": string;
  "on-surface-variant": string;
  "surface-dim": string;
  "surface-bright": string;
  "surface-container-lowest": string;
  "surface-container-low": string;
  "surface-container": string;
  "surface-container-high": string;
  "surface-container-highest": string;
  outline: string;
  "outline-variant": string;
  "inverse-surface": string;
  "on-inverse-surface": string;
  "inverse-primary": string;
  scrim: string;
  [role: string]: string;
}

const M3_ERROR = { light: "#b3261e", dark: "#f2b8b5" };
const M3_ERROR_CONTAINER = { light: "#f9dedc", dark: "#8c1d18" };
const M3_ON_ERROR = { light: "#ffffff", dark: "#601410" };
const M3_ON_ERROR_CONTAINER = { light: "#410e0b", dark: "#f9dedc" };

function schemeFromTones(
  hue: number,
  chroma: { primary: number; secondary: number; tertiary: number; neutral: number; neutralVariant: number },
  tones: {
    // OKLCH lightness for each role (≈ M3 tone / 100).
    primary: number; onPrimary: number; primaryContainer: number; onPrimaryContainer: number;
    secondary: number; onSecondary: number; secondaryContainer: number; onSecondaryContainer: number;
    tertiary: number; onTertiary: number; tertiaryContainer: number; onTertiaryContainer: number;
    surface: number; onSurface: number; onSurfaceVariant: number;
    containerLowest: number; containerLow: number; containerBase: number; containerHigh: number; containerHighest: number;
    surfaceDim: number; surfaceBright: number;
    outline: number; outlineVariant: number;
    inverseSurface: number; onInverseSurface: number; inversePrimary: number;
  },
): MaterialScheme {
  const role = (l: number, c: number, h = hue) => toHex(oklchToRgb({ l: clampL(l), c, h: normalizeHue(h) }));

  const scheme = {
    primary: role(tones.primary, chroma.primary),
    "on-primary": role(tones.onPrimary, chroma.primary),
    "primary-container": role(tones.primaryContainer, chroma.primary),
    "on-primary-container": role(tones.onPrimaryContainer, chroma.primary),
    secondary: role(tones.secondary, chroma.secondary, hue + 10),
    "on-secondary": role(tones.onSecondary, chroma.secondary, hue + 10),
    "secondary-container": role(tones.secondaryContainer, chroma.secondary, hue + 10),
    "on-secondary-container": role(tones.onSecondaryContainer, chroma.secondary, hue + 10),
    tertiary: role(tones.tertiary, chroma.tertiary, hue + 60),
    "on-tertiary": role(tones.onTertiary, chroma.tertiary, hue + 60),
    "tertiary-container": role(tones.tertiaryContainer, chroma.tertiary, hue + 60),
    "on-tertiary-container": role(tones.onTertiaryContainer, chroma.tertiary, hue + 60),
    surface: role(tones.surface, chroma.neutral),
    "on-surface": role(tones.onSurface, chroma.neutral),
    "on-surface-variant": role(tones.onSurfaceVariant, chroma.neutralVariant),
    "surface-container-lowest": role(tones.containerLowest, chroma.neutral),
    "surface-container-low": role(tones.containerLow, chroma.neutral),
    "surface-container": role(tones.containerBase, chroma.neutral),
    "surface-container-high": role(tones.containerHigh, chroma.neutral),
    "surface-container-highest": role(tones.containerHighest, chroma.neutral),
    "surface-dim": role(tones.surfaceDim, chroma.neutral),
    "surface-bright": role(tones.surfaceBright, chroma.neutral),
    outline: role(tones.outline, chroma.neutralVariant),
    "outline-variant": role(tones.outlineVariant, chroma.neutralVariant),
    "inverse-surface": role(tones.inverseSurface, chroma.neutral),
    "on-inverse-surface": role(tones.onInverseSurface, chroma.neutral),
    "inverse-primary": role(tones.inversePrimary, chroma.primary),
    scrim: "rgba(0, 0, 0, 0.42)",
  } as MaterialScheme;

  const isDark = tones.onSurface > tones.surface;
  scheme.error = isDark ? M3_ERROR.dark : M3_ERROR.light;
  scheme["on-error"] = isDark ? M3_ON_ERROR.dark : M3_ON_ERROR.light;
  scheme["error-container"] = isDark ? M3_ERROR_CONTAINER.dark : M3_ERROR_CONTAINER.light;
  scheme["on-error-container"] = isDark ? M3_ON_ERROR_CONTAINER.dark : M3_ON_ERROR_CONTAINER.light;

  // Clamp every text-on-surface pair to AA.
  const pairs: Array<[string, string]> = [
    ["on-primary", "primary"],
    ["on-primary-container", "primary-container"],
    ["on-secondary", "secondary"],
    ["on-secondary-container", "secondary-container"],
    ["on-tertiary", "tertiary"],
    ["on-tertiary-container", "tertiary-container"],
    ["on-surface", "surface"],
    ["on-surface-variant", "surface-container"],
    ["on-inverse-surface", "inverse-surface"],
  ];
  for (const [onRole, baseRole] of pairs) {
    const base = parseColor(scheme[baseRole]);
    const fg = parseColor(scheme[onRole]);
    if (base && fg && contrastRatio(fg, base) < TEXT_CONTRAST_MIN) {
      scheme[onRole] = toHex(ensureContrast(fg, base, TEXT_CONTRAST_MIN));
    }
  }
  return scheme;
}

/**
 * Generate a complete Material scheme pair (light + dark) from a single seed
 * color, in the spirit of Material You tonal palettes but on OKLCH — no new
 * dependencies, runs client-side.
 */
export function generateSchemeFromSeed(seed: string): { light: MaterialScheme; dark: MaterialScheme } {
  const seedParsed = parseColor(seed);
  const fallbackSeed = parseColor("#3b82f6")!;
  const seedOklch = rgbToOklch(seedParsed ?? fallbackSeed);
  const hue = seedOklch.h;
  const chroma = {
    primary: Math.max(0.09, Math.min(seedOklch.c, 0.15)),
    secondary: 0.05,
    tertiary: 0.07,
    neutral: 0.008,
    neutralVariant: 0.02,
  };

  const light = schemeFromTones(hue, chroma, {
    primary: 0.45, onPrimary: 0.98, primaryContainer: 0.9, onPrimaryContainer: 0.3,
    secondary: 0.5, onSecondary: 0.98, secondaryContainer: 0.89, onSecondaryContainer: 0.33,
    tertiary: 0.48, onTertiary: 0.98, tertiaryContainer: 0.89, onTertiaryContainer: 0.32,
    surface: 0.975, onSurface: 0.22, onSurfaceVariant: 0.45,
    containerLowest: 0.995, containerLow: 0.955, containerBase: 0.935, containerHigh: 0.915, containerHighest: 0.895,
    surfaceDim: 0.89, surfaceBright: 0.99,
    outline: 0.55, outlineVariant: 0.88,
    inverseSurface: 0.25, onInverseSurface: 0.96, inversePrimary: 0.82,
  });

  const dark = schemeFromTones(hue, chroma, {
    primary: 0.8, onPrimary: 0.22, primaryContainer: 0.35, onPrimaryContainer: 0.9,
    secondary: 0.8, onSecondary: 0.22, secondaryContainer: 0.35, onSecondaryContainer: 0.9,
    tertiary: 0.8, onTertiary: 0.22, tertiaryContainer: 0.35, onTertiaryContainer: 0.9,
    surface: 0.16, onSurface: 0.91, onSurfaceVariant: 0.75,
    containerLowest: 0.1, containerLow: 0.145, containerBase: 0.175, containerHigh: 0.215, containerHighest: 0.26,
    surfaceDim: 0.1, surfaceBright: 0.4,
    outline: 0.65, outlineVariant: 0.34,
    inverseSurface: 0.9, onInverseSurface: 0.18, inversePrimary: 0.5,
  });

  return { light, dark };
}

export { DERIVABLE_ROLES };
