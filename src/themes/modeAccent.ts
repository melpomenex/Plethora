/**
 * Mode-accent resolution (theme-mode-accent capability).
 *
 * `resolveModeAccent` is a pure, synchronous, deterministic function of the
 * theme: no DOM access, no randomness, no clock, no locale. It returns hex
 * strings only — never oklch()/color-mix() CSS (see design D2).
 *
 * Precedence chain:
 *   1. explicit `theme.colors.modeAccent` (hue intent, still clamped)
 *   2. best palette candidate (secondary/link/success/warning)
 *   3. synthesized hue rotation of primary (±150°)
 *   4. global per-variant default (corrupt/unparseable themes)
 * plus a monochrome neutral path that skips hue scoring entirely.
 */

import type { Theme } from "../types/theme";
import {
  clamp,
  contrastRatio,
  flattenOverBase,
  hueSeparation,
  mirrorIntoBand,
  normalizeHue,
  oklchToRgb,
  parseColor,
  rgbToHex,
  rgbToOklch,
  type Oklch,
  type Rgb,
} from "./color";

export interface ModeAccent {
  accent: string;
  foreground: string;
}

/** Hue separation (deg) required from the primary accent. */
const MIN_HUE_SEPARATION = 60;
/** WCAG contrast required against the surface and the tinted button blend. */
const MIN_CONTRAST = 3.0;
/** Chroma window for palette candidates (excludes mud and neon). */
const MIN_CHROMA = 0.025;
const MAX_CHROMA = 0.33;
/** Below this chroma everything counts as monochrome. */
const MONOCHROME_CHROMA = 0.04;
/** Contrast required of the foreground against the solid accent. */
const MIN_FOREGROUND_CONTRAST = 4.5;
/** Readable OKLCH lightness bands per theme variant. */
const DARK_READABLE_BAND = { low: 0.55, high: 0.85 };
const LIGHT_READABLE_BAND = { low: 0.35, high: 0.6 };

const DEFAULT_DARK: ModeAccent = { accent: "#22d3ee", foreground: "#0a0a0a" };
const DEFAULT_LIGHT: ModeAccent = { accent: "#4f46e5", foreground: "#ffffff" };

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

interface ParsedColor {
  rgb: Rgb;
  oklch: Oklch;
}

function parseOpaque(input: string | undefined, flattenBase: Rgb | null): ParsedColor | null {
  const parsed = parseColor(input);
  if (!parsed) return null;
  const rgb = parsed.a >= 1 ? { r: parsed.r, g: parsed.g, b: parsed.b } : flattenBase
    ? flattenOverBase(parsed, flattenBase)
    : { r: parsed.r, g: parsed.g, b: parsed.b };
  return { rgb, oklch: rgbToOklch(rgb) };
}

function pickForeground(accent: Rgb): string {
  // Prefer white; every color reaches at least ~4.58:1 against white or
  // near-black, so the black fallback always satisfies the 4.5:1 floor.
  return contrastRatio(WHITE, accent) >= MIN_FOREGROUND_CONTRAST ? "#ffffff" : "#0a0a0a";
}

/**
 * Blend `accent` at 12% over `surface` — the tinted button background the
 * accent text/border render over (`bg-mode-accent/10` + border).
 */
function tintBlend(accent: Rgb, surface: Rgb): Rgb {
  return flattenOverBase({ r: accent.r, g: accent.g, b: accent.b, a: 0.12 }, surface);
}

function meetsContrast(accent: Rgb, surface: Rgb): boolean {
  return (
    contrastRatio(accent, surface) >= MIN_CONTRAST &&
    contrastRatio(accent, tintBlend(accent, surface)) >= MIN_CONTRAST
  );
}

/**
 * Legibility clamp shared by the explicit, candidate, synthesized and neutral
 * stages: force the lightness into the variant-readable band, then nudge
 * lightness in 0.02 steps (bounded) until the accent clears 3:1 against both
 * the solid surface and the 12% tinted button background.
 */
function clampForLegibility(color: Oklch, surface: Rgb, isDark: boolean): Oklch {
  const band = isDark ? DARK_READABLE_BAND : LIGHT_READABLE_BAND;
  let l = mirrorIntoBand(color.l, band.low, band.high);
  let rgb = oklchToRgb({ ...color, l });

  const nudge = isDark ? 0.02 : -0.02;
  for (let step = 0; step < 10 && !meetsContrast(rgb, surface); step += 1) {
    l = clamp(l + nudge, 0, 1);
    rgb = oklchToRgb({ ...color, l });
  }

  return { ...color, l };
}

/**
 * Rotate the primary hue ±150°, choosing the direction that lands farthest
 * from every palette candidate hue.
 */
function synthesizeHue(primary: Oklch, candidateHues: number[]): number {
  const options = [normalizeHue(primary.h + 150), normalizeHue(primary.h - 150)];
  let best = options[0];
  let bestDistance = -1;
  for (const option of options) {
    const minDistance = candidateHues.length
      ? Math.min(...candidateHues.map((h) => hueSeparation(option, h)))
      : 180;
    if (minDistance > bestDistance) {
      bestDistance = minDistance;
      best = option;
    }
  }
  return best;
}

/**
 * Resolve the semantic mode accent (and its readable foreground) for a theme.
 * Deterministic: the same theme always yields the same output.
 */
export function resolveModeAccent(theme: Theme): ModeAccent {
  const isDark = theme.variant === "dark";
  const colors = theme.colors;

  // Alpha flattening happens over the theme background (design D2 step 1).
  const background = parseOpaque(colors.background, null)?.rgb ?? (isDark ? { r: 0x12, g: 0x14, b: 0x26 } : WHITE);

  // Stage 4 global default — reached only when even the primary color is
  // unparseable, so the CSS variables are never undefined.
  const primary = parseOpaque(colors.primary, background);
  if (!primary) {
    return isDark ? DEFAULT_DARK : DEFAULT_LIGHT;
  }

  // The button's surrounding surface: toolbar, falling back to card, then
  // background (design D2 step 2).
  const surface =
    parseOpaque(colors.toolbar, background)?.rgb ??
    parseOpaque(colors.card, background)?.rgb ??
    background;

  const explicit = parseOpaque(colors.modeAccent, background);

  const candidateNames = ["secondary", "link", "success", "warning"] as const;
  type CandidateName = (typeof candidateNames)[number];
  const candidates = candidateNames
    .map((name) => ({ name, parsed: parseOpaque(colors[name], background) }))
    .filter((entry): entry is { name: CandidateName; parsed: ParsedColor } => entry.parsed !== null);

  const candidateHues = candidates.map((entry) => entry.parsed.oklch.h);
  const allChromatic = [primary.oklch, ...candidates.map((entry) => entry.parsed.oklch)];

  let accent: Oklch | null = null;

  // Stage 1 — explicit value sets the hue intent; legibility still enforced.
  if (explicit) {
    accent = clampForLegibility(
      { ...explicit.oklch, c: clamp(explicit.oklch.c, 0, MAX_CHROMA) },
      surface,
      isDark
    );
  }

  // Monochrome neutral path — no hue invention for grayscale palettes.
  if (!accent && allChromatic.every((color) => color.c < MONOCHROME_CHROMA)) {
    const neutral =
      parseOpaque(colors.onSurface, background) ??
      parseOpaque(colors.text, background) ??
      parseOpaque(colors.onBackground, background);
    if (neutral) {
      accent = clampForLegibility(neutral.oklch, surface, isDark);
    }
  }

  // Stage 2 — best palette candidate by (capped contrast) + hue separation.
  if (!accent) {
    let bestScore = -Infinity;
    let bestCandidate: Oklch | null = null;
    for (const { parsed } of candidates) {
      const { oklch } = parsed;
      const hueSep = hueSeparation(oklch.h, primary.oklch.h);
      const contrast = contrastRatio(parsed.rgb, surface);
      const passes =
        hueSep >= MIN_HUE_SEPARATION &&
        contrast >= MIN_CONTRAST &&
        oklch.c >= MIN_CHROMA &&
        oklch.c <= MAX_CHROMA;
      if (!passes) continue;
      const normalizedContrast = clamp((contrast - MIN_CONTRAST) / (4.5 - MIN_CONTRAST), 0, 1);
      const score = normalizedContrast + hueSep / 180;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = oklch;
      }
    }
    if (bestCandidate) {
      accent = clampForLegibility(bestCandidate, surface, isDark);
    }
  }

  // Stage 3 — synthesized hue rotation of the primary.
  if (!accent) {
    const hue = synthesizeHue(primary.oklch, candidateHues);
    accent = clampForLegibility(
      {
        l: primary.oklch.l,
        c: clamp(primary.oklch.c, 0.08, 0.16),
        h: hue,
      },
      surface,
      isDark
    );
  }

  const accentRgb = oklchToRgb(accent);
  return {
    accent: rgbToHex(accentRgb),
    foreground: pickForeground(accentRgb),
  };
}
