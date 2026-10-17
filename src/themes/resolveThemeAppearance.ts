import { flattenOverBase, parseColor, rgbToHex } from "./color";
import type { Theme } from "../types/theme";
import { deriveMaterialRoles } from "./materialRoles";
import {
  normalizePaperPreferences,
  normalizeThemeMaterial,
  PAPER_PRESET_ID,
  type MaterialPreferences,
  type PaperDetail,
} from "./materials";
import { resolveReaderThemeTokens } from "../components/viewer/htmlReader/readerThemeTokens";

export interface AppearanceEnvironment {
  dpr?: number;
  deviceMemory?: number;
  saveData?: boolean;
  lowBattery?: boolean;
  eink?: boolean;
  forcedColors?: boolean;
  highContrast?: boolean;
  baseUrl?: string;
  assetFailure?: "webp" | "png";
}
export interface ResolvedPaper {
  presetId: typeof PAPER_PRESET_ID;
  requestedDetail: PaperDetail;
  effectiveDetail: PaperDetail;
  grainUrl: string;
  variationUrl: string;
  ruling: boolean;
  margin: boolean;
  displayTier: "srgb";
}

/** Stable, bounded selection. Gamut queries alone never authorize HDR or P3. */
export function resolvePaperMaterial(
  theme: Theme,
  preferences: MaterialPreferences,
  env: AppearanceEnvironment
): ResolvedPaper | null {
  if (
    !normalizeThemeMaterial(theme.material) ||
    env.eink ||
    env.forcedColors ||
    env.highContrast ||
    env.assetFailure === "png"
  )
    return null;
  const p = normalizePaperPreferences(preferences?.[PAPER_PRESET_ID]);
  const constrained =
    env.saveData || env.lowBattery || (env.deviceMemory > 0 && env.deviceMemory <= 4);
  const effectiveDetail = constrained ? "subtle" : p.detail;
  const dpr = Math.max(1, Math.min(4, env.dpr || 1));
  const widths = {
    subtle: [512, 1024, 1024, 1024],
    authentic: [512, 1024, 1536, 1536],
    maximum: [1024, 1024, 1536, 2048],
  };
  const width = widths[effectiveDetail][Math.ceil(dpr) - 1];
  const base = new URL("/theme-materials/legal-pad/v1/", env.baseUrl || "http://localhost/");
  const fallback = env.assetFailure === "webp";
  return {
    presetId: PAPER_PRESET_ID,
    requestedDetail: p.detail,
    effectiveDetail,
    grainUrl: new URL(
      fallback ? "grain-fallback-512.png" : `grain-${effectiveDetail}-${width}.webp`,
      base
    ).href,
    variationUrl: new URL(`variation-512.${fallback ? "png" : "webp"}`, base).href,
    ruling: p.ruling,
    margin: p.ruling && p.margin,
    displayTier: "srgb",
  };
}

export function resolveThemeAppearance(
  theme: Theme,
  preferences: MaterialPreferences = {},
  env: AppearanceEnvironment = {}
) {
  const accessibility = {
    eink: !!env.eink,
    forcedColors: !!env.forcedColors,
    highContrast: !!env.highContrast,
  };
  const colors = {
    ...deriveMaterialRoles(theme.colors, theme.variant),
    ...Object.fromEntries(Object.entries(theme.colors).map(([key,value])=>[
      key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()),value,
    ])),
    foreground:theme.colors.onBackground,
    'muted-foreground':theme.colors.textSecondary,
    popover:theme.colors.card,
  };
  const monochrome = env.eink || env.forcedColors;
  const base = parseColor(theme.colors.background);
  const bounds =
    base && normalizeThemeMaterial(theme.material)
      ? [0, 255].map((channel) =>
          rgbToHex(
            flattenOverBase(
              { r: channel, g: channel, b: channel, a: 1 - (1 - 8 / 255) * (1 - 3 / 255) },
              base
            )
          )
        )
      : [];
  const readerTokens = resolveReaderThemeTokens(
    monochrome
      ? {
          background: "#ffffff",
          surface: "#ffffff",
          mutedSurface: "#f4f4f4",
          foreground: "#000000",
          mutedForeground: "#222222",
          border: "#000000",
          link: "#000000",
          accent: "#000000",
          focus: "#000000",
        }
      : {},
    theme,
    monochrome ? [] : bounds
  );
  const paper = resolvePaperMaterial(theme, preferences, env);
  return {
    themeId: theme.id,
    variant: theme.variant,
    colors,
    readerTokens,
    paper,
    accessibility,
    revision: JSON.stringify([theme.id, theme.colors, paper, accessibility]),
  };
}
export type ResolvedThemeAppearance = ReturnType<typeof resolveThemeAppearance>;
