import { describe, it } from 'vitest';
import { builtInThemes } from '../builtin';
import { contrastRatio, parseColor } from '../color';

import { describe, expect, it } from 'vitest';
import {
  modernDarkTheme,
  mistralDarkTheme,
  nocturneDarkTheme,
  highContrastDarkTheme,
  stardustVoidTheme,
  velvetTwilightTheme,
  emberDuskTheme,
  abyssalDepthsTheme,
  burntUmberTheme,
  focusTheme,
  cyberDriveTheme,
  tokyoNeonTheme,
  nordicSlateTheme,
  neonPulseTheme,
} from '../builtin';
import { contrastRatio, parseColor } from '../color';

const auditedDarkThemes = [
  modernDarkTheme,
  mistralDarkTheme,
  nocturneDarkTheme,
  highContrastDarkTheme,
  stardustVoidTheme,
  velvetTwilightTheme,
  emberDuskTheme,
  abyssalDepthsTheme,
  burntUmberTheme,
  focusTheme,
  cyberDriveTheme,
  tokyoNeonTheme,
  nordicSlateTheme,
  neonPulseTheme,
];

describe('Dark themes contrast verification (WCAG AA 4.5:1)', () => {
  it('ensures muted/secondary text colors in dark themes meet 4.5:1 contrast against backgrounds and surfaces', () => {
    for (const theme of auditedDarkThemes) {
      const bg = parseColor(theme.colors.background)!;
      const surface = parseColor(theme.colors.surface)!;
      const textSecondary = parseColor(theme.colors.textSecondary);
      const secondary = parseColor(theme.colors.secondary);

      if (textSecondary) {
        const ratioBg = contrastRatio(textSecondary, bg);
        const ratioSurface = contrastRatio(textSecondary, surface);
        expect(
          ratioBg,
          `${theme.id} textSecondary (${theme.colors.textSecondary}) vs bg (${theme.colors.background})`
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratioSurface,
          `${theme.id} textSecondary (${theme.colors.textSecondary}) vs surface (${theme.colors.surface})`
        ).toBeGreaterThanOrEqual(4.5);
      }

      if (secondary) {
        const ratioBg = contrastRatio(secondary, bg);
        const ratioSurface = contrastRatio(secondary, surface);
        expect(
          ratioBg,
          `${theme.id} secondary (${theme.colors.secondary}) vs bg (${theme.colors.background})`
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          ratioSurface,
          `${theme.id} secondary (${theme.colors.secondary}) vs surface (${theme.colors.surface})`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
