/**
 * Palette configs for the shared jellyfish ambient renderer.
 * Each jellyfish theme sets effects.ambientPaletteId to one of these keys.
 */

export interface JellyfishPalette {
  oceanTop: string;
  oceanMid: string;
  oceanBottom: string;
  jellyPrimary: string;
  jellySecondary: string;
  jellyCore: string;
  glowPrimary: string;
  glowSecondary: string;
  tentacle: string;
  particle: string;
  caustic: string;
  vignette: string;
}

export const JELLYFISH_THEME_IDS = [
  'deep-ocean-glow',
  'bioluminescent-flow',
  'deep-sea-neon',
  'abyssal-dream',
] as const;

export type JellyfishThemeId = (typeof JELLYFISH_THEME_IDS)[number];

export const JELLYFISH_PALETTES: Record<JellyfishThemeId, JellyfishPalette> = {
  'deep-ocean-glow': {
    oceanTop: '#020617',
    oceanMid: '#050B2A',
    oceanBottom: '#071339',
    jellyPrimary: '#4F8CFF',
    jellySecondary: '#7657FF',
    jellyCore: '#6EA8FF',
    glowPrimary: '#4F8CFF',
    glowSecondary: '#9D7CFF',
    tentacle: '#76D6FF',
    particle: '#6EA8FF',
    caustic: '#4F8CFF',
    vignette: '#020617',
  },
  'bioluminescent-flow': {
    oceanTop: '#001416',
    oceanMid: '#001D20',
    oceanBottom: '#032A2D',
    jellyPrimary: '#00E5D4',
    jellySecondary: '#00B8D9',
    jellyCore: '#18F5E1',
    glowPrimary: '#00E5D4',
    glowSecondary: '#55FFFF',
    tentacle: '#72FFE8',
    particle: '#18F5E1',
    caustic: '#00B8D9',
    vignette: '#001416',
  },
  'deep-sea-neon': {
    oceanTop: '#100412',
    oceanMid: '#19051E',
    oceanBottom: '#230626',
    jellyPrimary: '#FF38C7',
    jellySecondary: '#9B45FF',
    jellyCore: '#FF5DD6',
    glowPrimary: '#FF38C7',
    glowSecondary: '#C56BFF',
    tentacle: '#FF91E8',
    particle: '#FF5DD6',
    caustic: '#9B45FF',
    vignette: '#100412',
  },
  'abyssal-dream': {
    oceanTop: '#010817',
    oceanMid: '#031329',
    oceanBottom: '#061E3B',
    jellyPrimary: '#268CFF',
    jellySecondary: '#5468FF',
    jellyCore: '#49B4FF',
    glowPrimary: '#268CFF',
    glowSecondary: '#7791FF',
    tentacle: '#81E7FF',
    particle: '#49B4FF',
    caustic: '#5468FF',
    vignette: '#010817',
  },
};

export function resolveJellyfishPalette(paletteId: string | undefined): JellyfishPalette {
  if (paletteId && paletteId in JELLYFISH_PALETTES) {
    return JELLYFISH_PALETTES[paletteId as JellyfishThemeId];
  }
  return JELLYFISH_PALETTES['deep-ocean-glow'];
}

/** Tiered glass surfaces — nav translucent, reading/modals opaque. */
export function createJellyfishScenicCSS(
  themeId: string,
  accent: string,
  accentRgb: string,
  shellTint: string,
  glassPanel: string,
): string {
  const accentSoft = accentRgb;
  return `
    :root[data-theme-id="${themeId}"] .app-shell {
      background: ${shellTint} !important;
      background-color: ${shellTint} !important;
    }
    :root[data-theme-id="${themeId}"] .bg-background:not(.app-shell),
    :root[data-theme-id="${themeId}"] .main-content,
    :root[data-theme-id="${themeId}"] .bg-cream {
      background: transparent !important;
      background-color: transparent !important;
    }
    :root[data-theme-id="${themeId}"] .sidebar-section {
      background: rgba(${accentSoft}, 0.08) !important;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-right: 1px solid rgba(${accentSoft}, 0.2);
    }
    :root[data-theme-id="${themeId}"] .sidebar-item-active {
      background: rgba(${accentSoft}, 0.14) !important;
      border-left: 3px solid ${accent} !important;
    }
    :root[data-theme-id="${themeId}"] .glass-panel,
    :root[data-theme-id="${themeId}"] .glass-panel-light,
    :root[data-theme-id="${themeId}"] .glass-card-enhanced {
      background: ${glassPanel} !important;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(${accentSoft}, 0.18) !important;
    }
    :root[data-theme-id="${themeId}"] .bg-popover,
    :root[data-theme-id="${themeId}"] [data-slot="dialog-content"],
    :root[data-theme-id="${themeId}"] .modal-content {
      background: var(--color-surface) !important;
      background-color: var(--color-surface) !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    :root[data-theme-id="${themeId}"] .reader-surface,
    :root[data-theme-id="${themeId}"] .html-reader-content,
    :root[data-theme-id="${themeId}"] .document-reader-pane {
      background: var(--color-background) !important;
      background-color: var(--color-background) !important;
    }
    :root[data-theme-id="${themeId}"] input:focus,
    :root[data-theme-id="${themeId}"] textarea:focus {
      border-color: ${accent} !important;
      box-shadow: 0 0 12px rgba(${accentSoft}, 0.25) !important;
    }
    :root[data-theme-id="${themeId}"] ::selection {
      background: rgba(${accentSoft}, 0.35);
    }
    @media (prefers-reduced-motion: reduce) {
      :root[data-theme-id="${themeId}"] * {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;
}
