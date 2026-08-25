import type { Theme } from '../../../types/theme';
import {
  contrastRatio,
  flattenOverBase,
  parseColor,
  rgbToHex,
  type Rgb,
} from '../../../themes/color';

export interface AppliedReaderColors {
  background?: string;
  surface?: string;
  mutedSurface?: string;
  foreground?: string;
  mutedForeground?: string;
  border?: string;
  link?: string;
  accent?: string;
  focus?: string;
}

export interface ReaderThemeTokens {
  background: string;
  surface: string;
  mutedSurface: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  link: string;
  accent: string;
  focus: string;
  measure: '66ch';
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

function opaqueColor(value: string | undefined, base: Rgb): Rgb | null {
  if (!value || value.trim().toLowerCase() === 'transparent') return null;
  const parsed = parseColor(value);
  return parsed ? flattenOverBase(parsed, base) : null;
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

function bestBlackOrWhite(background: Rgb): Rgb {
  return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
}

function ensureContrast(candidate: Rgb | null, background: Rgb, minimum: number): Rgb {
  // Leave a small margin so rounding the resolved color to 8-bit hex cannot
  // move a just-passing float below the required ratio.
  const targetRatio = minimum + 0.05;
  const start = candidate ?? bestBlackOrWhite(background);
  if (contrastRatio(start, background) >= targetRatio) return start;
  const target = bestBlackOrWhite(background);
  for (let step = 1; step <= 20; step += 1) {
    const adjusted = mix(start, target, step / 20);
    if (contrastRatio(adjusted, background) >= targetRatio) return adjusted;
  }
  return target;
}

function firstOpaque(values: Array<string | undefined>, base: Rgb): Rgb | null {
  for (const value of values) {
    const parsed = opaqueColor(value, base);
    if (parsed) return parsed;
  }
  return null;
}

/** Resolve opaque, measured reader colors from applied CSS and theme fallbacks. */
export function resolveReaderThemeTokens(
  applied: AppliedReaderColors,
  theme: Theme
): ReaderThemeTokens {
  const stableBase = theme.variant === 'light' ? WHITE : { r: 10, g: 15, b: 24 };
  const background =
    firstOpaque(
      [applied.background, applied.surface, theme.colors.background, theme.colors.surface, theme.colors.card],
      stableBase
    ) ?? stableBase;
  const surface =
    firstOpaque([applied.surface, theme.colors.card, theme.colors.surface], background) ?? background;
  const mutedSurface =
    firstOpaque(
      [applied.mutedSurface, theme.colors.surfaceVariant, theme.colors.input],
      surface
    ) ?? surface;

  const foreground = ensureContrast(
    firstOpaque(
      [applied.foreground, theme.colors.onBackground, theme.colors.text, theme.colors.onSurface],
      background
    ),
    background,
    4.5
  );
  const mutedForeground = ensureContrast(
    firstOpaque(
      [applied.mutedForeground, theme.colors.textSecondary, theme.colors.onSurface],
      background
    ) ?? foreground,
    background,
    4.5
  );
  // Link deliberately prefers the applied/theme link token over primary.
  const link = ensureContrast(
    firstOpaque([applied.link, theme.colors.link], background) ?? foreground,
    background,
    4.5
  );
  const accent = ensureContrast(
    firstOpaque([applied.accent, theme.colors.modeAccent, theme.colors.primary], background) ?? link,
    background,
    3
  );
  const focus = ensureContrast(
    firstOpaque([applied.focus, theme.colors.link, theme.colors.primary], background) ?? accent,
    background,
    3
  );
  const border = ensureContrast(
    firstOpaque([applied.border, theme.colors.border, theme.colors.outline], background),
    background,
    3
  );

  return {
    background: rgbToHex(background),
    surface: rgbToHex(surface),
    mutedSurface: rgbToHex(mutedSurface),
    foreground: rgbToHex(foreground),
    mutedForeground: rgbToHex(mutedForeground),
    border: rgbToHex(border),
    link: rgbToHex(link),
    accent: rgbToHex(accent),
    focus: rgbToHex(focus),
    measure: '66ch',
  };
}

export function readerThemeTokenCss(tokens: ReaderThemeTokens): string {
  return `
    --reader-background: ${tokens.background};
    --reader-surface: ${tokens.surface};
    --reader-muted-surface: ${tokens.mutedSurface};
    --reader-foreground: ${tokens.foreground};
    --reader-muted-foreground: ${tokens.mutedForeground};
    --reader-border: ${tokens.border};
    --reader-link: ${tokens.link};
    --reader-accent: ${tokens.accent};
    --reader-focus: ${tokens.focus};
    --reader-measure: ${tokens.measure};
  `;
}
