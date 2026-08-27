import type { Theme } from '../types/theme';
import {
  createJellyfishScenicCSS,
  JELLYFISH_PALETTES,
  type JellyfishThemeId,
} from './jellyfishPalettes';

const jellyfishTypography: Theme['typography'] = {
  fontFamily: '"Outfit", "Inter", sans-serif',
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
  },
  fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  lineHeight: { tight: 1.25, normal: 1.5, relaxed: 1.75 },
};

const jellyfishSpacing: Theme['spacing'] = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
};

const jellyfishRadius: Theme['radius'] = {
  none: '0',
  sm: '0.125rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
};

interface JellyfishThemeDef {
  id: JellyfishThemeId;
  name: string;
  description: string;
  colors: Theme['colors'];
  shadows: Theme['shadows'];
  accentRgb: string;
  shellTint: string;
  glassPanel: string;
}

const JELLYFISH_DEFS: JellyfishThemeDef[] = [
  {
    id: 'deep-ocean-glow',
    name: 'Deep Ocean Glow',
    description:
      'Animated jellyfish — deep navy abyss with cool electric blue and soft violet bioluminescence.',
    colors: {
      background: '#020617',
      onBackground: '#e8f0ff',
      surface: 'rgba(7, 19, 57, 0.88)',
      onSurface: '#e8f0ff',
      surfaceVariant: 'rgba(5, 11, 42, 0.75)',
      primary: '#4F8CFF',
      onPrimary: '#020617',
      primaryContainer: 'rgba(79, 140, 255, 0.18)',
      onPrimaryContainer: '#c8dcff',
      secondary: 'rgba(118, 87, 255, 0.35)',
      onSecondary: '#e8f0ff',
      outline: 'rgba(79, 140, 255, 0.22)',
      outlineVariant: 'rgba(79, 140, 255, 0.1)',
      error: '#ef4444',
      onError: '#ffffff',
      errorContainer: 'rgba(239, 68, 68, 0.2)',
      onErrorContainer: '#fee2e2',
      success: '#10b981',
      warning: '#f59e0b',
      toolbar: 'rgba(2, 6, 23, 0.82)',
      sidebar: 'rgba(5, 11, 42, 0.55)',
      card: 'rgba(7, 19, 57, 0.72)',
      input: 'rgba(5, 11, 42, 0.65)',
      border: 'rgba(79, 140, 255, 0.16)',
      text: '#e8f0ff',
      textSecondary: '#9db8e8',
      link: '#76D6FF',
      modeAccent: '#F59E0B',
    },
    shadows: {
      sm: '0 2px 8px rgba(79, 140, 255, 0.1)',
      md: '0 4px 16px rgba(79, 140, 255, 0.14)',
      lg: '0 8px 32px rgba(79, 140, 255, 0.18)',
      xl: '0 16px 48px rgba(79, 140, 255, 0.22)',
    },
    accentRgb: '79, 140, 255',
    shellTint: 'rgba(2, 6, 23, 0.58)',
    glassPanel: 'rgba(7, 19, 57, 0.58)',
  },
  {
    id: 'bioluminescent-flow',
    name: 'Bioluminescent Flow',
    description:
      'Animated jellyfish — near-black teal abyss with natural aqua and cyan marine bioluminescence.',
    colors: {
      background: '#001416',
      onBackground: '#d8faf5',
      surface: 'rgba(3, 42, 45, 0.9)',
      onSurface: '#d8faf5',
      surfaceVariant: 'rgba(0, 29, 32, 0.78)',
      primary: '#00E5D4',
      onPrimary: '#001416',
      primaryContainer: 'rgba(0, 229, 212, 0.16)',
      onPrimaryContainer: '#b8fff4',
      secondary: 'rgba(0, 184, 217, 0.32)',
      onSecondary: '#d8faf5',
      outline: 'rgba(0, 229, 212, 0.2)',
      outlineVariant: 'rgba(0, 229, 212, 0.08)',
      error: '#ef4444',
      onError: '#ffffff',
      errorContainer: 'rgba(239, 68, 68, 0.2)',
      onErrorContainer: '#fee2e2',
      success: '#10b981',
      warning: '#f59e0b',
      toolbar: 'rgba(0, 20, 22, 0.85)',
      sidebar: 'rgba(0, 29, 32, 0.55)',
      card: 'rgba(3, 42, 45, 0.75)',
      input: 'rgba(0, 29, 32, 0.65)',
      border: 'rgba(0, 229, 212, 0.14)',
      text: '#d8faf5',
      textSecondary: '#6ec9be',
      link: '#72FFE8',
      modeAccent: '#FB923C',
    },
    shadows: {
      sm: '0 2px 8px rgba(0, 229, 212, 0.1)',
      md: '0 4px 16px rgba(0, 229, 212, 0.14)',
      lg: '0 8px 32px rgba(0, 229, 212, 0.18)',
      xl: '0 16px 48px rgba(0, 229, 212, 0.22)',
    },
    accentRgb: '0, 229, 212',
    shellTint: 'rgba(0, 20, 22, 0.58)',
    glassPanel: 'rgba(3, 42, 45, 0.58)',
  },
  {
    id: 'deep-sea-neon',
    name: 'Deep Sea Neon',
    description:
      'Animated jellyfish — dark plum depths with restrained magenta and violet neon bioluminescence.',
    colors: {
      background: '#100412',
      onBackground: '#fce8f5',
      surface: 'rgba(35, 6, 38, 0.9)',
      onSurface: '#fce8f5',
      surfaceVariant: 'rgba(25, 5, 30, 0.78)',
      primary: '#FF5DD6',
      onPrimary: '#100412',
      primaryContainer: 'rgba(255, 93, 214, 0.16)',
      onPrimaryContainer: '#ffd8f0',
      secondary: 'rgba(155, 69, 255, 0.32)',
      onSecondary: '#fce8f5',
      outline: 'rgba(255, 93, 214, 0.2)',
      outlineVariant: 'rgba(255, 93, 214, 0.08)',
      error: '#ff4466',
      onError: '#ffffff',
      errorContainer: 'rgba(255, 68, 102, 0.22)',
      onErrorContainer: '#ffd0d8',
      success: '#3dd9a0',
      warning: '#f0d060',
      toolbar: 'rgba(16, 4, 18, 0.85)',
      sidebar: 'rgba(25, 5, 30, 0.55)',
      card: 'rgba(35, 6, 38, 0.75)',
      input: 'rgba(25, 5, 30, 0.65)',
      border: 'rgba(255, 93, 214, 0.14)',
      text: '#fce8f5',
      textSecondary: '#c98ab8',
      link: '#FF91E8',
      modeAccent: '#38BDF8',
    },
    shadows: {
      sm: '0 2px 8px rgba(255, 93, 214, 0.1)',
      md: '0 4px 16px rgba(255, 93, 214, 0.14)',
      lg: '0 8px 32px rgba(255, 93, 214, 0.18)',
      xl: '0 16px 48px rgba(255, 93, 214, 0.22)',
    },
    accentRgb: '255, 93, 214',
    shellTint: 'rgba(16, 4, 18, 0.58)',
    glassPanel: 'rgba(35, 6, 38, 0.58)',
  },
  {
    id: 'abyssal-dream',
    name: 'Abyssal Dream',
    description:
      'Animated jellyfish — ethereal deep indigo ocean with dreamy cyan and blue-violet glow.',
    colors: {
      background: '#010817',
      onBackground: '#e4f0ff',
      surface: 'rgba(6, 30, 59, 0.9)',
      onSurface: '#e4f0ff',
      surfaceVariant: 'rgba(3, 19, 41, 0.78)',
      primary: '#49B4FF',
      onPrimary: '#010817',
      primaryContainer: 'rgba(38, 140, 255, 0.16)',
      onPrimaryContainer: '#c8e4ff',
      secondary: 'rgba(84, 104, 255, 0.32)',
      onSecondary: '#e4f0ff',
      outline: 'rgba(49, 180, 255, 0.2)',
      outlineVariant: 'rgba(49, 180, 255, 0.08)',
      error: '#ef4444',
      onError: '#ffffff',
      errorContainer: 'rgba(239, 68, 68, 0.2)',
      onErrorContainer: '#fee2e2',
      success: '#10b981',
      warning: '#f59e0b',
      toolbar: 'rgba(1, 8, 23, 0.85)',
      sidebar: 'rgba(3, 19, 41, 0.55)',
      card: 'rgba(6, 30, 59, 0.75)',
      input: 'rgba(3, 19, 41, 0.65)',
      border: 'rgba(49, 180, 255, 0.14)',
      text: '#e4f0ff',
      textSecondary: '#8aaed4',
      link: '#81E7FF',
      modeAccent: '#F59E0B',
    },
    shadows: {
      sm: '0 2px 8px rgba(38, 140, 255, 0.1)',
      md: '0 4px 16px rgba(38, 140, 255, 0.14)',
      lg: '0 8px 32px rgba(38, 140, 255, 0.18)',
      xl: '0 16px 48px rgba(38, 140, 255, 0.22)',
    },
    accentRgb: '49, 180, 255',
    shellTint: 'rgba(1, 8, 23, 0.58)',
    glassPanel: 'rgba(6, 30, 59, 0.58)',
  },
];

function buildJellyfishTheme(def: JellyfishThemeDef): Theme {
  const palette = JELLYFISH_PALETTES[def.id];
  return {
    id: def.id,
    name: def.name,
    variant: 'dark',
    description: def.description,
    colors: def.colors,
    typography: jellyfishTypography,
    spacing: jellyfishSpacing,
    radius: jellyfishRadius,
    shadows: def.shadows,
    effects: {
      backgroundAnimation: 'jellyfish',
      ambientPaletteId: def.id,
    },
    customCSS: createJellyfishScenicCSS(
      def.id,
      def.colors.primary,
      def.accentRgb,
      def.shellTint,
      def.glassPanel,
    ),
  };
}

export const deepOceanGlowTheme = buildJellyfishTheme(JELLYFISH_DEFS[0]);
export const bioluminescentFlowTheme = buildJellyfishTheme(JELLYFISH_DEFS[1]);
export const deepSeaNeonTheme = buildJellyfishTheme(JELLYFISH_DEFS[2]);
export const abyssalDreamTheme = buildJellyfishTheme(JELLYFISH_DEFS[3]);

export const jellyfishThemes: Theme[] = [
  deepOceanGlowTheme,
  bioluminescentFlowTheme,
  deepSeaNeonTheme,
  abyssalDreamTheme,
];
