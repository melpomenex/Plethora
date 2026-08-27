import { describe, expect, it } from 'vitest';
import {
  JELLYFISH_PALETTES,
  JELLYFISH_THEME_IDS,
  resolveJellyfishPalette,
} from '../jellyfishPalettes';
import { jellyfishThemes } from '../jellyfishThemes';
import { builtInThemes } from '../builtin';

describe('jellyfishPalettes', () => {
  it('defines four palette entries', () => {
    expect(JELLYFISH_THEME_IDS).toHaveLength(4);
    for (const id of JELLYFISH_THEME_IDS) {
      expect(JELLYFISH_PALETTES[id]).toBeDefined();
    }
  });

  it('falls back to deep-ocean-glow for unknown ids', () => {
    expect(resolveJellyfishPalette('unknown')).toEqual(JELLYFISH_PALETTES['deep-ocean-glow']);
  });
});

describe('jellyfish theme registration', () => {
  it('registers all four themes in builtInThemes', () => {
    for (const theme of jellyfishThemes) {
      expect(builtInThemes.some((t) => t.id === theme.id)).toBe(true);
      expect(theme.effects?.backgroundAnimation).toBe('jellyfish');
      expect(theme.effects?.ambientPaletteId).toBe(theme.id);
    }
  });

  it('scenic CSS exposes the backdrop through shell and card surfaces', () => {
    const css = jellyfishThemes[0].customCSS ?? '';
    expect(css).toContain('.adaptive-shell-root');
    expect(css).toContain('.bg-card');
    expect(css).toContain('backdrop-filter');
  });

  it('uses distinct primary colors per variant', () => {
    const primaries = jellyfishThemes.map((t) => t.colors.primary);
    const unique = new Set(primaries);
    expect(unique.size).toBe(4);
  });
});
