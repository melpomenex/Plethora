/**
 * Eagerly-loadable fallback themes.
 *
 * These two themes are the only ones the app needs before first paint
 * (ThemeContext seeds its state with them). They live in their own module so
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
