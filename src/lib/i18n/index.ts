import { useCallback } from "react";
import { useSettingsStore } from "../../stores/settingsStore";

export type { Dict } from "./locales/en";

export type SupportedLocale = "en" | "zh" | "es" | "de" | "fr" | "ja";

import { en, type Dict } from "./locales/en";

/**
 * Dynamic locale loaders.
 *
 * `en` is imported eagerly above (synchronous fallback) AND listed here so the
 * shape is uniform; calling `loaders.en()` just resolves to the already-loaded
 * module. The other locales are ONLY reachable through these dynamic imports,
 * which lets Vite code-split each non-English locale into its own chunk.
 *
 * Locale files use a named export matching their code (e.g. `export const zh`),
 * so each dynamic import resolves to `{ [locale]: Dict }` (the `en`/`Dict`
 * re-imports inside the locale files are tree-shaken out of the consuming chunk).
 */
const loaders: Record<SupportedLocale, () => Promise<Record<string, Dict>>> = {
  en: () => import("./locales/en"),
  zh: () => import("./locales/zh"),
  es: () => import("./locales/es"),
  de: () => import("./locales/de"),
  fr: () => import("./locales/fr"),
  ja: () => import("./locales/ja"),
};

/**
 * Loaded dictionaries. Starts with only `en` (the synchronous fallback) so the
 * app can render immediately; other locales are populated by `loadLocale`.
 */
const dictionaries: Partial<Record<SupportedLocale, Dict>> = { en };

/** In-flight load promises, to avoid duplicate imports for the same locale. */
const loading: Partial<Record<SupportedLocale, Promise<Dict>>> = {};

/**
 * Lazily load a locale's dictionary and register it. Safe to call repeatedly;
 * concurrent calls for the same locale share one import. `en` resolves sync.
 */
export async function loadLocale(locale: SupportedLocale): Promise<Dict> {
  if (dictionaries[locale]) return dictionaries[locale]!;
  if (loading[locale]) return loading[locale]!;

  const promise = loaders[locale]()
    .then((mod) => {
      // Locale files export their dict under a key matching the locale code.
      const dict = mod[locale];
      if (!dict) {
        throw new Error(`i18n: locale "${locale}" did not export its dictionary`);
      }
      dictionaries[locale] = dict;
      delete loading[locale];
      return dict;
    })
    .catch((err) => {
      delete loading[locale];
      console.error(`i18n: failed to load locale "${locale}", falling back to en`, err);
      // Fall back to English so callers always get a usable dict.
      return dictionaries.en!;
    });

  loading[locale] = promise;
  return promise;
}

function normalizeLocale(input?: string | null): SupportedLocale {
  const value = String(input || "en").trim().toLowerCase();
  const base = value.split(/[-_]/)[0];
  if (base === "zh") return "zh";
  if (base === "es") return "es";
  if (base === "de") return "de";
  if (base === "fr") return "fr";
  if (base === "ja") return "ja";
  return "en";
}

function formatTemplate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

export function getCurrentLocale(): SupportedLocale {
  const language = useSettingsStore.getState().settings.general.language;
  return normalizeLocale(language);
}

/**
 * Translate a key. If the active locale's dictionary isn't loaded yet (because
 * it's being lazy-loaded), this transparently falls back to English so the UI
 * still renders; once the async load completes the next render uses the new
 * locale. This keeps the `t()` API synchronous.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const locale = getCurrentLocale();
  const dict = dictionaries[locale] || dictionaries.en;
  const template = dict[key] || dictionaries.en[key] || key;
  return formatTemplate(template, vars);
}

export function useI18n() {
  const language = useSettingsStore((state) => state.settings.general.language);
  const locale = normalizeLocale(language);
  // Referentially stable per locale: effects that list `t` in their dependency
  // array only re-run when the locale (or their other deps) change, instead of
  // on every render. `translate` reads `dictionaries` at call time, so a
  // lazily-loaded locale dictionary is picked up on the next call without a
  // re-render — same as before memoization.
  const translate = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = dictionaries[locale] || dictionaries.en;
      const template = dict[key] || dictionaries.en[key] || key;
      return formatTemplate(template, vars);
    },
    [locale]
  );
  return { locale, t: translate };
}

/**
 * Keep dictionaries in sync with the persisted language setting:
 *  - trigger a load on module init for the initial (possibly non-en) locale,
 *  - and re-load whenever the language changes at runtime.
 * This runs once per page load; the subscription is intentionally never
 * unsubscribed (the i18n module is a singleton for the app lifetime).
 */
{
  const ensureLocaleLoaded = (language: string) => {
    const locale = normalizeLocale(language);
    if (locale !== "en" && !dictionaries[locale] && !loading[locale]) {
      void loadLocale(locale);
    }
  };

  // Initial boot: load the persisted locale if it isn't English.
  ensureLocaleLoaded(useSettingsStore.getState().settings.general.language);

  // React to runtime language changes (e.g. Settings → Language selector).
  useSettingsStore.subscribe((state, prevState) => {
    const next = state.settings.general.language;
    if (next !== prevState.settings.general.language) {
      ensureLocaleLoaded(next);
    }
  });
}
