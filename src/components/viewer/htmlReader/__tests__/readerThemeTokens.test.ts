import { describe, expect, it } from 'vitest';
import { builtInThemes, biolumeAbyssTheme, modernDarkTheme } from '../../../../themes/builtin';
import { contrastRatio, parseColor, flattenOverBase } from '../../../../themes/color';
import { resolveReaderThemeTokens } from '../readerThemeTokens';
import { buildArticleReaderStyles } from '../articleReaderStyles';
import { buildCompatibilityReaderStyles } from '../compatibilityReaderStyles';

function ratio(foreground: string, background: string): number {
  const fg = parseColor(foreground)!;
  const bg = parseColor(background)!;
  return contrastRatio(flattenOverBase(fg, bg), flattenOverBase(bg, { r: 255, g: 255, b: 255 }));
}

describe('resolveReaderThemeTokens', () => {
  it('meets contrast thresholds for every built-in theme variant', () => {
    for (const theme of builtInThemes) {
      const tokens = resolveReaderThemeTokens({}, theme);
      expect(ratio(tokens.foreground, tokens.background), `${theme.id} foreground`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens.mutedForeground, tokens.background), `${theme.id} muted`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens.link, tokens.background), `${theme.id} link`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens.border, tokens.background), `${theme.id} border`).toBeGreaterThanOrEqual(3);
      expect(ratio(tokens.focus, tokens.background), `${theme.id} focus`).toBeGreaterThanOrEqual(3);
    }
  });

  it('prefers the theme link token and keeps Biolume Abyss light foreground', () => {
    const modern = resolveReaderThemeTokens({}, modernDarkTheme);
    expect(modern.link).toBe(modernDarkTheme.colors.link.toLowerCase());
    expect(modern.link).not.toBe(modernDarkTheme.colors.primary.toLowerCase());
    const abyss = resolveReaderThemeTokens({}, biolumeAbyssTheme);
    expect(abyss.foreground).toBe('#e0f2fe');
  });

  it('repairs low-contrast translucent custom inputs', () => {
    const tokens = resolveReaderThemeTokens(
      {
        background: 'rgba(20, 20, 30, 0.2)',
        surface: 'rgba(15, 23, 42, 0.9)',
        foreground: 'rgba(25, 25, 35, 0.5)',
        mutedForeground: '#252535',
        link: '#202030',
        border: '#252535',
        focus: '#252535',
      },
      biolumeAbyssTheme
    );
    expect(ratio(tokens.foreground, tokens.background)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokens.link, tokens.background)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(tokens.border, tokens.background)).toBeGreaterThanOrEqual(3);
  });
});

describe('reader stylesheet boundaries', () => {
  const tokens = resolveReaderThemeTokens({}, biolumeAbyssTheme);
  const settings = { fontSize: 16, lineHeight: 1.6, fontFamily: 'serif' as const };

  it('owns canonical semantics without a destructive descendant reset', () => {
    const css = buildArticleReaderStyles(tokens, settings);
    expect(css).toContain('--reader-measure: 66ch');
    expect(css).toMatch(/strong, b \{ font-weight: 700/);
    expect(css).toMatch(/em, i \{ font-style: italic/);
    expect(css).toContain('.inc-table-wrap');
    expect(css).toContain('overflow-x: auto');
    expect(css).not.toMatch(/body \*\s*\{[^}]*font-weight:\s*inherit/s);
  });

  it('keeps compatibility repair rules scoped outside canonical CSS', () => {
    for (const kind of [
      'canonical-raw-fallback',
      'legacy-arxiv',
      'browser-capture',
      'ocr-html',
      'raw-html',
    ] as const) {
      const css = buildCompatibilityReaderStyles(kind, tokens, settings);
      expect(css).toContain('body *');
      expect(css).toContain('.page');
      expect(css).toContain('strong, b { font-weight: 700');
      if (kind === 'legacy-arxiv') expect(css).toContain('.ltx_document');
    }
  });
});
