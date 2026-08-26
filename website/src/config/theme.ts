/**
 * Theme bootstrap for all marketing pages.
 *
 * Resolution rules (refine-useplethora-visual-product-storytelling D1):
 *  - A stored explicit choice of 'light' | 'dark' | 'system' always wins.
 *  - Anything else — including no stored value at all — resolves to Light,
 *    so a first visit lands on the light editorial theme even on dark-mode
 *    operating systems. 'system' remains a live Auto choice; it is written
 *    explicitly by the toggle (never by removing the key).
 *
 * THEME_BOOTSTRAP_SCRIPT runs synchronously in <head> before first paint
 * (no FOUC). BaseLayout injects the exact string below verbatim via
 * set:html; unit tests evaluate that same string against stubbed globals,
 * so shipped behavior stays pinned even if this file drifts.
 */

export const THEME_STORAGE_KEY = 'plethora-theme';

/** Browser-chrome tint per effective theme (mirrors tokens.css paper values). */
export const THEMATIC_META_COLORS = {
  light: '#f3f0e8',
  dark: '#14101a',
} as const;

export type StoredTheme = 'light' | 'dark' | 'system';

/** Explicit choices win; missing/corrupt values fall back to Light. */
export function resolveStoredTheme(stored: string | null | undefined): StoredTheme {
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
}

export function computeEffectiveTheme(theme: StoredTheme, prefersDark: boolean): 'light' | 'dark' {
  return theme === 'dark' || (theme === 'system' && prefersDark) ? 'dark' : 'light';
}

/**
 * Exact <head> bootstrap source. Keep it self-contained ES5-ish: it must run
 * before any module loads and fail soft when storage is unavailable.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function () {
  var LIGHT = '#f3f0e8';
  var DARK = '#14101a';
  function apply(theme, prefersDark) {
    var isDark = theme === 'dark' || (theme === 'system' && !!prefersDark);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.effectiveTheme = isDark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    var meta = document.getElementById('meta-theme-color');
    if (meta) meta.setAttribute('content', isDark ? DARK : LIGHT);
  }
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme =
      stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
    apply(theme, window.matchMedia('(prefers-color-scheme: dark)').matches);
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', function (event) {
        if ((document.documentElement.dataset.theme || '') === 'system') {
          apply('system', event.matches);
        }
      });
  } catch (e) {
    apply('light', false);
  }
})();`;
