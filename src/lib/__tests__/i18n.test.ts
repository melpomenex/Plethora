import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { getCurrentLocale, t, useI18n } from "../i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { en } from "../i18n/locales/en";
import { zh } from "../i18n/locales/zh";
import { es } from "../i18n/locales/es";
import { de } from "../i18n/locales/de";
import { fr } from "../i18n/locales/fr";
import { ja } from "../i18n/locales/ja";

useSettingsStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

const allLocales = { en, zh, es, de, fr, ja } as const;
const localeNames = { en: "English", zh: "Chinese", es: "Spanish", de: "German", fr: "French", ja: "Japanese" };

describe("i18n", () => {
  it("normalizes regional locales to supported base languages", async () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: {
          ...state.settings.general,
          language: "zh-CN",
        },
      },
    }));

    expect(getCurrentLocale()).toBe("zh");
    // Non-English locales are lazy-loaded (code-split) and auto-loaded when the
    // language setting changes. The dynamic import resolves asynchronously, so
    // wait for `t()` to reflect the Chinese dictionary before asserting.
    await vi.waitFor(() => {
      expect(t("review.title")).toBe("复习");
    });
  });

  it("interpolates placeholders and falls back to english", () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: {
          ...state.settings.general,
          language: "pt-BR",
        },
      },
    }));

    expect(getCurrentLocale()).toBe("en");
    expect(t("review.cutoffGuarantee", { count: 7 })).toContain("7");
  });

  it("every non-English locale has translations for all English keys", () => {
    const enKeys = Object.keys(en);
    for (const [locale, dict] of Object.entries(allLocales)) {
      if (locale === "en") continue;
      const localeKeys = Object.keys(dict);
      const missing = enKeys.filter((k) => !localeKeys.includes(k));
      if (missing.length > 0) {
        // Only report the first 5 missing keys for readability
        expect.fail(
          `${localeNames[locale as keyof typeof localeNames]} is missing ${missing.length} keys: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` ...and ${missing.length - 5} more` : ""}`
        );
      }
    }
  });

  it("t keeps its identity across re-renders with the locale unchanged, and changes when the language setting changes", () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: {
          ...state.settings.general,
          language: "en",
        },
      },
    }));

    const { result, rerender } = renderHook(() => useI18n());
    const firstT = result.current.t;
    expect(result.current.locale).toBe("en");
    expect(firstT("review.title")).toBeTruthy();

    // Re-render for an unrelated reason: same locale → same `t` reference, so
    // effects listing `t` in their deps do not re-fire.
    rerender();
    expect(result.current.t).toBe(firstT);

    // Switching language → new locale → new `t` reference, so effects re-run.
    act(() => {
      useSettingsStore.setState((state) => ({
        settings: {
          ...state.settings,
          general: {
            ...state.settings.general,
            language: "zh",
          },
        },
      }));
    });
    expect(result.current.locale).toBe("zh");
    expect(result.current.t).not.toBe(firstT);
  });
});
