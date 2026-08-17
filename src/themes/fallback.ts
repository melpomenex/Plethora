/**
 * Eagerly-loadable fallback themes.
 *
 * These themes are the only ones the app needs before first paint
 * (ThemeContext seeds its state with them): the default theme
 * (Biolume Abyss) plus the legacy fallbacks. They live in their own module so
 * the app root can import them WITHOUT statically importing `./builtin` —
 * a module that is both statically and dynamically imported gets merged into
 * the static importer's chunk, which previously dragged the entire theme
 * catalog (builtin.ts + legacyIndex.ts, ~176 KB source) into the entry bundle
 * and silently defeated the lazy `import("../themes/builtin")` in ThemeContext.
 *
 * `builtin.ts` re-exports these constants, so the catalog stays the single
 * public registry; nothing else should import this module except the app-root
 * bootstrap path (ThemeContext).
 */
import { Theme } from '../types/theme';

export const milkyMatchaTheme: Theme = {
  id: 'milky-matcha',
  name: 'Milky Matcha',
  variant: 'light',
  description: 'Calming green tea-inspired theme',
  colors: {
    background: '#f7f3e9',
    onBackground: '#253024',
    surface: '#fdfaf4',
    onSurface: '#253024',
    surfaceVariant: '#ffffff',
    primary: '#7da88e',
    onPrimary: '#ffffff',
    primaryContainer: '#cbe4c1',
    onPrimaryContainer: '#253024',
    secondary: '#9ec4ab',
    onSecondary: '#253024',
    outline: '#d9d2c3',
    outlineVariant: '#c4bda8',
    error: '#e57373',
    onError: '#ffffff',
    errorContainer: '#ef5350',
    onErrorContainer: '#ffebee',
    success: '#7da88e',
    warning: '#d4a045',
    toolbar: '#f7f3e9',
    sidebar: '#fdfaf4',
    card: '#ffffff',
    input: '#ffffff',
    border: '#d9d2c3',
    text: '#253024',
    textSecondary: '#4a5a4a',
    link: '#7da88e',
  },
  typography: {
    fontFamily: 'Nunito, "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      md: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
    '3xl': '4rem',
  },
  radius: {
    none: '0',
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    '2xl': '1.25rem',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  },
};

export const superGameBroTheme: Theme = {
  id: 'super-game-bro',
  name: 'Super Game Bro',
  variant: 'dark',
  description: 'Retro gaming-inspired theme',
  colors: {
    background: '#121426',
    onBackground: '#f7f1f6',
    surface: '#19213f',
    onSurface: '#f7f1f6',
    surfaceVariant: '#223458',
    primary: '#e44b6f',
    onPrimary: '#ffffff',
    primaryContainer: '#c23b5d',
    onPrimaryContainer: '#ffe7ee',
    secondary: '#5e3c95',
    onSecondary: '#ffffff',
    outline: '#3b4a72',
    outlineVariant: '#2a3a5c',
    error: '#ff8080',
    onError: '#ffffff',
    errorContainer: '#d14442',
    onErrorContainer: '#ffe0df',
    success: '#5ef084',
    warning: '#ffd045',
    toolbar: '#151c35',
    sidebar: '#0d2a4b',
    card: '#19213f',
    input: '#121426',
    border: '#3b4a72',
    text: '#f7f1f6',
    textSecondary: '#dacbd9',
    link: '#ff7c98',
  },
  typography: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      md: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
      '3xl': '1.875rem',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
    '3xl': '4rem',
  },
  radius: {
    none: '0',
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    '2xl': '1.25rem',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.3)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.4)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.4)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.4)',
  },
};

// The app default. Must stay in this module (not ./builtin) so the first
// paint uses the real default instead of a placeholder fallback theme.
export const biolumeAbyssTheme: Theme = {
  id: 'biolume-abyss',
  name: 'Biolume Abyss',
  variant: 'dark',
  description: 'Deep oceanic abyss with floating bioluminescent spores.',
  colors: {
    background: '#020b14',
    onBackground: '#e0f2fe',
    surface: 'rgba(10, 25, 41, 0.7)',
    onSurface: '#e0f2fe',
    surfaceVariant: 'rgba(15, 38, 64, 0.6)',
    primary: '#06b6d4',
    onPrimary: '#022c22',
    primaryContainer: 'rgba(6, 182, 212, 0.2)',
    onPrimaryContainer: '#cffafe',
    secondary: 'rgba(16, 185, 129, 0.3)',
    onSecondary: '#e0f2fe',
    outline: 'rgba(14, 116, 144, 0.25)',
    outlineVariant: 'rgba(14, 116, 144, 0.15)',
    error: '#ef4444',
    onError: '#ffffff',
    errorContainer: 'rgba(239, 68, 68, 0.2)',
    onErrorContainer: '#fee2e2',
    success: '#10b981',
    warning: '#f59e0b',
    toolbar: 'rgba(2, 11, 20, 0.8)',
    sidebar: 'rgba(3, 16, 30, 0.6)',
    card: 'rgba(10, 25, 41, 0.5)',
    input: 'rgba(10, 25, 41, 0.4)',
    border: 'rgba(6, 182, 212, 0.15)',
    text: '#e0f2fe',
    textSecondary: '#7dd3fc',
    link: '#22d3ee',
  },
  typography: {
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
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
    '3xl': '4rem',
  },
  radius: {
    none: '0',
    sm: '0.125rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    '2xl': '1.5rem',
    full: '9999px',
  },
  shadows: {
    sm: '0 2px 8px rgba(6, 182, 212, 0.08)',
    md: '0 4px 16px rgba(6, 182, 212, 0.15)',
    lg: '0 8px 32px rgba(14, 116, 144, 0.2)',
    xl: '0 16px 48px rgba(14, 116, 144, 0.25)',
  },
  effects: {
    backgroundAnimation: 'bioglow',
  },
  customCSS: `
    :root[data-theme-id="biolume-abyss"] .app-shell {
      background: rgba(2, 11, 20, 0.6) !important;
      background-color: rgba(2, 11, 20, 0.6) !important;
    }
    :root[data-theme-id="biolume-abyss"] .bg-background:not(.app-shell),
    :root[data-theme-id="biolume-abyss"] .main-content,
    :root[data-theme-id="biolume-abyss"] .bg-cream {
      background: transparent !important;
      background-color: transparent !important;
    }
    :root[data-theme-id="biolume-abyss"] .sidebar-section {
      background: rgba(3, 16, 30, 0.5) !important;
      backdrop-filter: blur(12px);
      border-right: 1px solid rgba(14, 116, 144, 0.25);
    }
    :root[data-theme-id="biolume-abyss"] .sidebar-item-active {
      background: rgba(6, 182, 212, 0.15) !important;
      border-left: 3px solid #06b6d4 !important;
      color: #cffafe !important;
    }
    :root[data-theme-id="biolume-abyss"] .glass-panel,
    :root[data-theme-id="biolume-abyss"] .glass-panel-light,
    :root[data-theme-id="biolume-abyss"] .glass-card-enhanced {
      background: rgba(10, 25, 41, 0.55) !important;
      backdrop-filter: blur(16px);
      border: 1px solid rgba(6, 182, 212, 0.18) !important;
      box-shadow: 0 8px 32px rgba(14, 116, 144, 0.1) !important;
    }
  `,
};
