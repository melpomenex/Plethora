/**
 * Client-side theme control runtime shared by header controls.
 *
 * Semantics pinned by tests/unit/theme.test.ts (D1):
 *  - Selecting Light/Auto/Dark WRITES the choice explicitly — Auto stores
 *    'system', it never clears the key. Removing the key would silently
 *    drift first-visit visitors away from their stored choice.
 *  - 'system' keeps following OS preference changes until overridden.
 */

import {
  computeEffectiveTheme,
  resolveStoredTheme,
  THEMATIC_META_COLORS,
  THEME_STORAGE_KEY,
  type StoredTheme,
} from '../config/theme.ts';

/** True when the value is one of the three explicit choices. */
export function isStoredTheme(value: string | null | undefined): value is StoredTheme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function prefersDarkMatches(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/**
 * Apply a resolved theme to the document: data attributes, color-scheme,
 * and the theme-color meta. Mirrors the <head> bootstrap behavior.
 */
export function applyThemeToDom(theme: StoredTheme, prefersDark = prefersDarkMatches()): void {
  if (typeof document === 'undefined') return;
  const isDark = computeEffectiveTheme(theme, prefersDark) === 'dark';

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.effectiveTheme = isDark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

  const meta = document.getElementById('meta-theme-color');
  if (meta) {
    meta.setAttribute('content', isDark ? THEMATIC_META_COLORS.dark : THEMATIC_META_COLORS.light);
  }
}

/**
 * Persist the visitor's explicit choice and apply it immediately.
 * Auto is stored as the literal string 'system'.
 */
export function storeAndApplyTheme(theme: StoredTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode etc.) — still apply for this visit.
  }
  applyThemeToDom(theme);

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    const isDark = computeEffectiveTheme(theme, prefersDarkMatches()) === 'dark';
    try {
      window.dispatchEvent(
        new CustomEvent('plethora-theme-change', { detail: { theme, isDark } }),
      );
    } catch {
      // CustomEvent unavailable in exotic embeds — ignore.
    }
  }
}

/** Reflect the current stored/resolved choice onto [data-theme-set] controls. */
export function refreshThemeControls(doc: Pick<Document, 'querySelectorAll'> = document): void {
  if (typeof document === 'undefined') return;
  const current = isStoredTheme(document.documentElement.dataset.theme)
    ? document.documentElement.dataset.theme
    : resolveStoredTheme(null);
  doc.querySelectorAll<HTMLButtonElement>('[data-theme-set]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.themeSet === current ? 'true' : 'false');
  });
}

/** Wire click handlers on [data-theme-set] controls (idempotent per element). */
export function setupThemeControls(): void {
  if (typeof document === 'undefined') return;
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-theme-set]');
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    if (btn.dataset.themeWired === 'true') return;
    btn.dataset.themeWired = 'true';
    btn.addEventListener('click', () => {
      const raw = btn.dataset.themeSet;
      if (!isStoredTheme(raw)) return;
      storeAndApplyTheme(raw);
      refreshThemeControls();
    });
  });
}
