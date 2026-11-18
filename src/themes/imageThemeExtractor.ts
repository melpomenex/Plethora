/**
 * Perceptual OKLCH Image-to-Theme Engine
 *
 * Extracts a harmonious palette from an image's RGBA pixels using OKLCH
 * histogram clustering with chroma/saliency weighting, then synthesizes a
 * complete Plethora `Theme` (with mood presets and WCAG AA contrast floors).
 */

import {
  clamp,
  contrastRatio,
  hueSeparation,
  normalizeHue,
  oklchToRgb,
  parseColor,
  rgbToHex,
  rgbToOklch,
  type Oklch,
  type Rgb,
} from "./color";
import type {
  Theme,
  ThemeBackgroundImage,
  ThemeColors,
  ThemeRadius,
  ThemeShadows,
  ThemeSpacing,
  ThemeTypography,
  ThemeVariant,
} from "../types/theme";

export type ImageThemeMood = "vibrant" | "editorial" | "deep-glass" | "high-contrast";

export interface PaletteSwatch {
  hex: string;
  oklch: Oklch;
  /** Fraction of sampled pixels in this cluster (0–1). */
  population: number;
  /** Perceptual saliency score combining population and chroma. */
  score: number;
}

export interface ExtractedImagePalette {
  /** Dominant atmospheric color (used to subtly tint neutral surfaces). */
  atmosphere: Oklch;
  /** Primary vibrant accent. */
  primary: Oklch;
  /** Secondary distinct accent. */
  secondary: Oklch;
  /** Tertiary distinct accent. */
  tertiary: Oklch;
  /** Median OKLCH lightness (0–1) across sampled pixels. */
  medianLightness: number;
  /** Suggested variant based on image lightness. */
  suggestedVariant: ThemeVariant;
  /** Top representative hex swatches for user inspection / accent override. */
  swatches: PaletteSwatch[];
}

export interface SynthesizeImageThemeOptions {
  id?: string;
  name: string;
  variant: ThemeVariant;
  mood: ImageThemeMood;
  /** Optional hex override when the user clicks a specific swatch or color. */
  primaryOverride?: string;
  backgroundImage: ThemeBackgroundImage;
  /** Base typography/spacing/radius/shadows from an existing theme. */
  baseTokens: {
    typography: ThemeTypography;
    spacing: ThemeSpacing;
    radius: ThemeRadius;
    shadows: ThemeShadows;
  };
}

interface BucketAccum {
  count: number;
  sumL: number;
  sumA: number;
  sumB: number;
}

const HUE_BINS = 24; // 15° per bin
const LIGHTNESS_BINS = 6;
const CHROMA_BINS = 4;

/**
 * Extract a perceptual OKLCH palette from raw RGBA pixels.
 * Works in pure JS (no DOM required) so it is fast and unit-testable.
 */
export function extractPaletteFromPixels(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number
): ExtractedImagePalette {
  const totalPixels = Math.max(1, width * height);
  // Sample up to ~9,216 pixels (96x96)
  const stride = Math.max(1, Math.floor(totalPixels / 9216));
  const buckets = new Map<number, BucketAccum>();
  const lightnessHist = new Uint32Array(64);
  let validCount = 0;

  for (let idx = 0; idx < totalPixels; idx += stride) {
    const offset = idx * 4;
    if (offset + 3 >= pixels.length) break;
    const aAlpha = pixels[offset + 3];
    if (aAlpha < 128) continue;

    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const oklch = rgbToOklch({ r, g, b });

    validCount++;
    const lIdx = Math.min(63, Math.max(0, Math.floor(oklch.l * 63)));
    lightnessHist[lIdx]++;

    const hBin = oklch.c < 0.025 ? 0 : Math.floor(normalizeHue(oklch.h) / (360 / HUE_BINS)) % HUE_BINS;
    const lBin = Math.min(LIGHTNESS_BINS - 1, Math.max(0, Math.floor(oklch.l * LIGHTNESS_BINS)));
    const cBin = Math.min(CHROMA_BINS - 1, Math.max(0, Math.floor((oklch.c / 0.32) * CHROMA_BINS)));
    const key = (hBin * LIGHTNESS_BINS + lBin) * CHROMA_BINS + cBin;

    const rad = (oklch.h * Math.PI) / 180;
    const labA = oklch.c * Math.cos(rad);
    const labB = oklch.c * Math.sin(rad);

    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.sumL += oklch.l;
      existing.sumA += labA;
      existing.sumB += labB;
    } else {
      buckets.set(key, { count: 1, sumL: oklch.l, sumA: labA, sumB: labB });
    }
  }

  if (validCount === 0) {
    const fallback: Oklch = { l: 0.62, c: 0.14, h: 250 };
    return {
      atmosphere: { l: 0.2, c: 0.02, h: 250 },
      primary: fallback,
      secondary: { l: 0.68, c: 0.12, h: 295 },
      tertiary: { l: 0.72, c: 0.11, h: 195 },
      medianLightness: 0.25,
      suggestedVariant: "dark",
      swatches: [{ hex: rgbToHex(oklchToRgb(fallback)), oklch: fallback, population: 1, score: 1 }],
    };
  }

  // Median lightness
  let cumulative = 0;
  let medianLightness = 0.35;
  const half = validCount / 2;
  for (let i = 0; i < 64; i++) {
    cumulative += lightnessHist[i];
    if (cumulative >= half) {
      medianLightness = (i + 0.5) / 64;
      break;
    }
  }

  // Convert buckets into scored swatches
  const rawClusters: PaletteSwatch[] = [];
  for (const acc of buckets.values()) {
    const l = acc.sumL / acc.count;
    const avgA = acc.sumA / acc.count;
    const avgB = acc.sumB / acc.count;
    const c = Math.sqrt(avgA * avgA + avgB * avgB);
    const h = normalizeHue((Math.atan2(avgB, avgA) * 180) / Math.PI);
    const population = acc.count / validCount;

    // Saliency: sublinear population weight * chroma boost * midtone preference
    const midtoneBoost = 1 - Math.abs(l - 0.56) * 0.55;
    const chromaWeight = 0.18 + Math.min(c, 0.32) * 5.0;
    const score = Math.pow(population, 0.62) * chromaWeight * Math.max(0.35, midtoneBoost);
    const oklch: Oklch = { l, c, h };
    rawClusters.push({
      hex: rgbToHex(oklchToRgb(oklch)),
      oklch,
      population,
      score,
    });
  }

  rawClusters.sort((a, b) => b.score - a.score);

  // Deduplicate visually similar swatches (OKLCH distance)
  const swatches: PaletteSwatch[] = [];
  for (const cand of rawClusters) {
    const tooClose = swatches.some((kept) => {
      const dL = Math.abs(kept.oklch.l - cand.oklch.l);
      const dC = Math.abs(kept.oklch.c - cand.oklch.c);
      const dH = kept.oklch.c < 0.03 || cand.oklch.c < 0.03 ? 0 : hueSeparation(kept.oklch.h, cand.oklch.h) / 180;
      return dL * 1.4 + dC * 2.2 + dH * 0.9 < 0.22;
    });
    if (!tooClose) {
      swatches.push(cand);
      if (swatches.length >= 8) break;
    }
  }

  // Atmosphere: highest population cluster (preferring non-extreme lightness)
  const byPopulation = [...rawClusters].sort((a, b) => b.population - a.population);
  const atmosphere = (byPopulation[0] ?? swatches[0]).oklch;

  // Primary: highest saliency colorful cluster (fallback to top swatch)
  const colorful = swatches.filter((s) => s.oklch.c >= 0.045);
  const primary = (colorful[0] ?? swatches[0]).oklch;

  // Secondary: next colorful cluster separated by >= 30° hue
  const secondaryCluster = colorful.find((s) => hueSeparation(s.oklch.h, primary.h) >= 30);
  const secondary: Oklch = secondaryCluster
    ? secondaryCluster.oklch
    : {
        l: clamp(primary.l + 0.04, 0.35, 0.8),
        c: clamp(primary.c * 0.85, 0.04, 0.22),
        h: normalizeHue(primary.h + 42),
      };

  // Tertiary: third distinct cluster >= 30° from both primary & secondary
  const tertiaryCluster = colorful.find(
    (s) => hueSeparation(s.oklch.h, primary.h) >= 30 && hueSeparation(s.oklch.h, secondary.h) >= 28
  );
  const tertiary: Oklch = tertiaryCluster
    ? tertiaryCluster.oklch
    : {
        l: clamp(primary.l + 0.02, 0.35, 0.8),
        c: clamp(primary.c * 0.8, 0.04, 0.2),
        h: normalizeHue(primary.h - 48),
      };

  return {
    atmosphere,
    primary,
    secondary,
    tertiary,
    medianLightness,
    suggestedVariant: medianLightness > 0.62 ? "light" : "dark",
    swatches,
  };
}

function oklchHex(l: number, c: number, h: number): string {
  return rgbToHex(oklchToRgb({ l: clamp(l, 0.02, 0.99), c: Math.max(0, c), h: normalizeHue(h) }));
}

function ensureContrastHex(fg: Oklch, bgRgb: Rgb, minRatio: number, preferLighter: boolean): string {
  let l = fg.l;
  let rgb = oklchToRgb({ l, c: fg.c, h: fg.h });
  let step = 0;
  while (contrastRatio(rgb, bgRgb) < minRatio && step < 28) {
    l = preferLighter ? clamp(l + 0.03, 0.02, 0.99) : clamp(l - 0.03, 0.02, 0.99);
    // Reduce chroma near extremes so sRGB gamut doesn't clip weirdly
    const c = l > 0.92 || l < 0.12 ? Math.min(fg.c, 0.04) : fg.c;
    rgb = oklchToRgb({ l, c, h: fg.h });
    step++;
  }
  return rgbToHex(rgb);
}

function pickOnColor(bgHex: string, tintHue: number): string {
  const bgRgb = parseColor(bgHex) ?? { r: 18, g: 20, b: 38 };
  const lightCandidate: Oklch = { l: 0.97, c: 0.012, h: tintHue };
  const darkCandidate: Oklch = { l: 0.14, c: 0.02, h: tintHue };
  const lightRgb = oklchToRgb(lightCandidate);
  const darkRgb = oklchToRgb(darkCandidate);
  return contrastRatio(lightRgb, bgRgb) >= contrastRatio(darkRgb, bgRgb)
    ? ensureContrastHex(lightCandidate, bgRgb, 4.5, true)
    : ensureContrastHex(darkCandidate, bgRgb, 4.5, false);
}

interface MoodParams {
  surfaceChroma: number;
  accentChromaMin: number;
  accentChromaMax: number;
  scrimOpacity: number;
  surfaceOpacity: number;
  blur: number;
  contrastFloor: number;
}

const MOOD_PARAMS: Record<ImageThemeMood, MoodParams> = {
  vibrant: {
    surfaceChroma: 0.024,
    accentChromaMin: 0.12,
    accentChromaMax: 0.24,
    scrimOpacity: 0.48,
    surfaceOpacity: 0.76,
    blur: 6,
    contrastFloor: 4.6,
  },
  editorial: {
    surfaceChroma: 0.012,
    accentChromaMin: 0.06,
    accentChromaMax: 0.14,
    scrimOpacity: 0.58,
    surfaceOpacity: 0.84,
    blur: 10,
    contrastFloor: 4.8,
  },
  "deep-glass": {
    surfaceChroma: 0.02,
    accentChromaMin: 0.1,
    accentChromaMax: 0.21,
    scrimOpacity: 0.36,
    surfaceOpacity: 0.66,
    blur: 14,
    contrastFloor: 4.8,
  },
  "high-contrast": {
    surfaceChroma: 0.008,
    accentChromaMin: 0.11,
    accentChromaMax: 0.22,
    scrimOpacity: 0.72,
    surfaceOpacity: 0.92,
    blur: 12,
    contrastFloor: 7.0,
  },
};

export function getMoodDefaults(mood: ImageThemeMood): Pick<
  ThemeBackgroundImage,
  "blur" | "scrimOpacity" | "surfaceOpacity" | "brightness"
> {
  const m = MOOD_PARAMS[mood];
  return {
    blur: m.blur,
    scrimOpacity: m.scrimOpacity,
    surfaceOpacity: m.surfaceOpacity,
    brightness: 0.95,
  };
}

/**
 * Synthesize a complete `Theme` from an extracted OKLCH palette + mood/variant.
 */
export function synthesizeThemeFromPalette(
  palette: ExtractedImagePalette,
  options: SynthesizeImageThemeOptions
): Theme {
  const { variant, mood, primaryOverride, backgroundImage, baseTokens } = options;
  const isDark = variant === "dark";
  const m = MOOD_PARAMS[mood];

  let primarySeed = palette.primary;
  if (primaryOverride) {
    const parsed = parseColor(primaryOverride);
    if (parsed) primarySeed = rgbToOklch(parsed);
  }

  const atmoHue = palette.atmosphere.c >= 0.02 ? palette.atmosphere.h : primarySeed.h;
  const sC = m.surfaceChroma;

  // Surface ramp
  const background = isDark ? oklchHex(0.14, sC, atmoHue) : oklchHex(0.965, sC * 0.75, atmoHue);
  const surface = isDark ? oklchHex(0.18, sC * 1.05, atmoHue) : oklchHex(0.985, sC * 0.55, atmoHue);
  const surfaceVariant = isDark ? oklchHex(0.23, sC * 1.15, atmoHue) : oklchHex(0.925, sC * 0.95, atmoHue);
  const card = isDark ? oklchHex(0.20, sC * 1.05, atmoHue) : oklchHex(0.99, sC * 0.45, atmoHue);
  const sidebar = isDark ? oklchHex(0.16, sC * 1.1, atmoHue) : oklchHex(0.945, sC * 0.85, atmoHue);
  const toolbar = isDark ? oklchHex(0.17, sC * 1.05, atmoHue) : oklchHex(0.955, sC * 0.75, atmoHue);
  const input = isDark ? oklchHex(0.22, sC * 1.0, atmoHue) : oklchHex(0.975, sC * 0.6, atmoHue);
  const outline = isDark ? oklchHex(0.42, sC * 1.2, atmoHue) : oklchHex(0.62, sC * 1.1, atmoHue);
  const outlineVariant = isDark ? oklchHex(0.29, sC * 1.0, atmoHue) : oklchHex(0.84, sC * 0.85, atmoHue);

  const bgRgb = parseColor(background) ?? { r: 20, g: 22, b: 34 };
  const surfRgb = parseColor(surface) ?? bgRgb;

  const onBackground = ensureContrastHex(
    { l: isDark ? 0.93 : 0.16, c: 0.012, h: atmoHue },
    bgRgb,
    m.contrastFloor,
    isDark
  );
  const onSurface = ensureContrastHex(
    { l: isDark ? 0.94 : 0.15, c: 0.01, h: atmoHue },
    surfRgb,
    m.contrastFloor,
    isDark
  );
  const textSecondary = ensureContrastHex(
    { l: isDark ? 0.74 : 0.40, c: sC * 0.9, h: atmoHue },
    surfRgb,
    4.5,
    isDark
  );

  // Accents
  const primaryChroma = clamp(
    primarySeed.c < 0.03 ? m.accentChromaMin : primarySeed.c * 1.1,
    m.accentChromaMin,
    m.accentChromaMax
  );
  const primaryOklch: Oklch = {
    l: isDark ? 0.72 : 0.50,
    c: primaryChroma,
    h: primarySeed.h,
  };
  const primary = ensureContrastHex(primaryOklch, bgRgb, 3.2, isDark);
  const onPrimary = pickOnColor(primary, primarySeed.h);

  const primaryContainer = isDark
    ? oklchHex(0.29, clamp(primaryChroma * 0.65, 0.05, 0.13), primarySeed.h)
    : oklchHex(0.90, clamp(primaryChroma * 0.42, 0.03, 0.09), primarySeed.h);
  const onPrimaryContainer = pickOnColor(primaryContainer, primarySeed.h);

  const secChroma = clamp(palette.secondary.c || primaryChroma * 0.8, m.accentChromaMin * 0.8, m.accentChromaMax * 0.9);
  const secondary = ensureContrastHex(
    { l: isDark ? 0.70 : 0.48, c: secChroma, h: palette.secondary.h },
    bgRgb,
    3.0,
    isDark
  );
  const onSecondary = pickOnColor(secondary, palette.secondary.h);

  const terChroma = clamp(palette.tertiary.c || primaryChroma * 0.75, m.accentChromaMin * 0.75, m.accentChromaMax * 0.85);
  const tertiary = ensureContrastHex(
    { l: isDark ? 0.72 : 0.48, c: terChroma, h: palette.tertiary.h },
    bgRgb,
    3.0,
    isDark
  );

  const link = ensureContrastHex(
    { l: isDark ? 0.76 : 0.46, c: clamp(primaryChroma, 0.1, 0.2), h: primarySeed.h },
    surfRgb,
    4.5,
    isDark
  );

  // Functional colors (kept semantically recognizable)
  const error = isDark ? "#f87171" : "#dc2626";
  const onError = pickOnColor(error, 25);
  const errorContainer = isDark ? "#451a1d" : "#fee2e2";
  const onErrorContainer = pickOnColor(errorContainer, 25);
  const success = isDark ? "#4ade80" : "#16a34a";
  const warning = isDark ? "#fbbf24" : "#d97706";

  const colors: ThemeColors = {
    background,
    onBackground,
    surface,
    onSurface,
    surfaceVariant,
    primary,
    onPrimary,
    primaryContainer,
    onPrimaryContainer,
    secondary,
    onSecondary,
    tertiary,
    outline,
    outlineVariant,
    error,
    onError,
    errorContainer,
    onErrorContainer,
    success,
    warning,
    toolbar,
    sidebar,
    card,
    input,
    border: outlineVariant,
    text: onSurface,
    textSecondary,
    link,
  };

  return {
    id: options.id ?? `custom-img-${Date.now()}`,
    name: options.name.trim() || "Image Theme",
    variant,
    description: `Generated from image (${mood})`,
    author: "Custom",
    version: "1.0.0",
    colors,
    typography: baseTokens.typography,
    spacing: baseTokens.spacing,
    radius: baseTokens.radius,
    shadows: baseTokens.shadows,
    effects: {
      backgroundImage,
    },
  };
}
