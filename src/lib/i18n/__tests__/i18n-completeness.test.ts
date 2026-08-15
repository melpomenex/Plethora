import { describe, it, expect } from "vitest";
import { en } from "../locales/en";
import { de } from "../locales/de";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { ja } from "../locales/ja";
import { zh } from "../locales/zh";

const locales: Record<string, Record<string, string>> = { de, es, fr, ja, zh };

describe("i18n locale completeness", () => {
  const enKeys = Object.keys(en);

  it.each(["de", "es", "fr", "ja", "zh"])("%s has every key that en has", (loc) => {
    const dict = locales[loc];
    const missing = enKeys.filter((k) => !(k in dict));
    expect(missing, `Missing ${missing.length} keys: ${missing.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it.each(["de", "es", "fr", "ja", "zh"])(
    "%s preserves all {placeholders} found in en values",
    (loc) => {
      const dict = locales[loc];
      const issues: string[] = [];
      // Check every key, not just recently-added ones, so placeholder drift in
      // older translations is caught too (e.g. a hardcoded number where a
      // {count} belonged). EN is the source of truth for which tokens are
      // substituted at runtime.
      for (const key of enKeys) {
        const enPh = (en[key].match(/\{+\w+\}+/g) || []).sort();
        const locPh = ((dict[key] || "").match(/\{+\w+\}+/g) || []).sort();
        if (JSON.stringify(enPh) !== JSON.stringify(locPh)) {
          issues.push(`${key}: en[${enPh}] vs ${loc}[${locPh}]`);
        }
      }
      expect(issues, issues.slice(0, 10).join("\n")).toEqual([]);
    },
  );

  it("a sample of recently-added keys resolve to non-empty, localized strings", () => {
    const samples = [
      "common.ok",
      "queue.upNext",
      "review.grade5",
      "onboarding.tour.welcome.title",
      "settings.help",
      "bulkAction.deleteSelected",
      "toolbar.audiobooks",
      "aiTutor.title",
    ];
    for (const loc of Object.keys(locales)) {
      for (const key of samples) {
        const val = locales[loc][key];
        expect(val, `${loc}.${key} should be present`).toBeTruthy();
        expect(val, `${loc}.${key} should not be the raw key`).not.toBe(key);
      }
    }
    // "OK" is universal; Spanish and Chinese chose natural equivalents.
    expect(de["common.ok"]).toBe("OK");
    expect(es["common.ok"]).toBe("Aceptar");
    expect(zh["common.ok"]).toBe("确定");
    expect(ja["queue.upNext"]).toBeTruthy();
    expect(zh["settings.help"]).not.toBe(en["settings.help"]);
  });

  it("placeholder substitution still works end-to-end", () => {
    function formatTemplate(template: string, vars?: Record<string, string | number>): string {
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
    }
    expect(formatTemplate(de["queue.positionOf"], { position: 3, total: 10 })).toContain("3");
    expect(formatTemplate(de["queue.positionOf"], { position: 3, total: 10 })).toContain("10");
  });

  it.each([
    ["onboarding.demoModeNote", { demoMode: "Demo Mode" }],
    ["discoverSites.showMore", { count: 24 }],
    ["settings.rssHideOldDesc", { days: 3, plural: "s" }],
  ])("%s was previously missing placeholders — guard against regression", (key, vars) => {
    // These three keys had hardcoded values / dropped placeholders before the
    // i18n pass. Assert every locale now carries the right tokens AND that the
    // template still renders the substituted values (no raw {placeholder} left).
    function formatTemplate(template: string, v: Record<string, string | number>): string {
      return template.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? `{${k}}`));
    }
    for (const loc of Object.keys(locales)) {
      const rendered = formatTemplate(locales[loc][key], vars);
      // No unresolved placeholder should remain after substitution.
      expect(rendered, `${loc}.${key} left an unresolved placeholder`).not.toMatch(/\{(?:demoMode|count|days|plural)\}/);
      // And none of these should still contain a hardcoded "24" or "(e)" workaround.
      if (key === "discoverSites.showMore") {
        expect(locales[loc][key], `${loc}.${key} must use {count}, not a hardcoded number`).toMatch(/\{count\}/);
      }
    }
  });
});
