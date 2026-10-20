import { describe, expect, it } from "vitest";
import {
  SETTINGS_SEARCH_ENTRIES,
  createSettingsSearchAvailabilitySnapshot,
  findSettingsSearchEntry,
  isSettingsSearchEntryAvailable,
  type SettingsSearchAvailabilitySnapshot,
} from "../settingsSearchCatalog";
import {
  normalizeSettingsSearchText,
  resolveSettingsSearchCatalog,
  searchSettings,
} from "../settingsSearch";
import { SETTINGS_SECTION_METADATA, SettingsTab } from "../../settingsSections";
import { en } from "../../../../lib/i18n/locales/en";
import { zh } from "../../../../lib/i18n/locales/zh";
import { es } from "../../../../lib/i18n/locales/es";
import { de } from "../../../../lib/i18n/locales/de";
import { fr } from "../../../../lib/i18n/locales/fr";
import { ja } from "../../../../lib/i18n/locales/ja";
import { getLocaleRevision, loadLocale, t as liveTranslate } from "../../../../lib/i18n";
import { useSettingsStore } from "../../../../stores/settingsStore";

const DICTIONARIES = { en, zh, es, de, fr, ja } as const;

function desktop(overrides: Partial<SettingsSearchAvailabilitySnapshot> = {}): SettingsSearchAvailabilitySnapshot {
  return {
    cloudAvailable: false,
    platform: "desktop",
    appUpdaterAvailable: true,
    browserExtensionAvailable: true,
    notebooklmAvailable: true,
    onDeviceAiAvailable: false,
    companionEnabled: false,
    fsrsEnabled: false,
    daqeEnabled: false,
    ttsProvider: "system",
    ...overrides,
  };
}

function catalogFor(
  locale: keyof typeof DICTIONARIES = "en",
  availability: SettingsSearchAvailabilitySnapshot = desktop(),
) {
  const dict = DICTIONARIES[locale];
  return resolveSettingsSearchCatalog(SETTINGS_SEARCH_ENTRIES, {
    translate: (key) => dict[key] ?? key,
    availability,
  });
}

function idsFor(query: string, locale: keyof typeof DICTIONARIES = "en", availability = desktop()) {
  return searchSettings(catalogFor(locale, availability), query).map(
    (result) => result.entry.entry.id,
  );
}

describe("Settings search matcher", () => {
  it("normalizes case, whitespace, hyphens, and punctuation identically", () => {
    const variants = [
      "font size",
      "  FONT   SIZE  ",
      "Font-Size",
      "font.size",
    ];
    const baseline = idsFor("font size");
    expect(baseline.length).toBeGreaterThan(0);
    for (const variant of variants) {
      expect(idsFor(variant), variant).toEqual(baseline);
    }
    expect(normalizeSettingsSearchText("  FONT—SIZE ")).toBe("font size");
  });

  it("finds the interface and EPUB font-size controls with distinct destinations", () => {
    const results = searchSettings(catalogFor(), "font size");
    const ids = results.map((result) => result.entry.entry.id);
    expect(ids).toContain("appearance.fontSize");
    expect(ids).toContain("documents.epubFontSize");
    const interfaceResult = results.find((result) => result.entry.entry.id === "appearance.fontSize")!;
    const epubResult = results.find((result) => result.entry.entry.id === "documents.epubFontSize")!;
    expect(interfaceResult.entry.breadcrumb).toContain("Appearance");
    expect(epubResult.entry.breadcrumb).toContain("Documents");
    expect(interfaceResult.entry.entry.targetId).not.toBe(epubResult.entry.entry.targetId);
  });

  it("matches reversed multiword queries within one entry", () => {
    for (const query of ["EPUB font size", "size font EPUB", "font EPUB size"]) {
      const ids = idsFor(query);
      expect(ids[0], query).toBe("documents.epubFontSize");
      expect(ids, query).not.toContain("appearance.fontSize");
    }
  });

  it("finds everyday aliases", () => {
    expect(idsFor("bigger text")).toContain("appearance.fontSize");
    expect(idsFor("volume buttons")).toContain("appearance.volumeRocker");
    expect(idsFor("vibration")).toContain("general.hapticsEnabled");
    expect(idsFor("dark mode")).toContain("appearance.theme");
    expect(idsFor("speech to text")).toContain("audioTranscription.models");
    expect(idsFor("speech-to-text")).toContain("audioTranscription.models");
    expect(idsFor("tts")).toContain("tts.enabled");
  });

  it("tolerates one bounded adjacent transposition but ranks exact matches first", () => {
    const typo = idsFor("font siez");
    expect(typo).toContain("appearance.fontSize");
    expect(typo).toContain("documents.epubFontSize");
    const exact = idsFor("font size");
    expect(exact[0]).toBe("appearance.fontSize");
    expect(typo[0]).toBe("appearance.fontSize");
    // A correctly spelled exact label must outrank a typo-only match.
    const exactRank = exact.indexOf("appearance.fontSize");
    const typoRank = typo.indexOf("appearance.fontSize");
    expect(exactRank).toBeLessThanOrEqual(typoRank);
  });

  it("does not fuzzy-match short or unrelated tokens broadly", () => {
    expect(idsFor("xyzzy")).toEqual([]);
    expect(idsFor("fnt")).toEqual([]);
    expect(idsFor("font xyzzy")).toEqual([]);
    expect(idsFor("completely unrelated private sk-live-secret")).toEqual([]);
  });

  it("requires every token to match a single entry", () => {
    // "font" matches Appearance, "whisper" matches Audio Transcription, but
    // no entry borrows one token from the other.
    expect(idsFor("font whisper")).toEqual([]);
  });

  it("keeps category results but ranks concrete destinations ahead at equal tier", () => {
    const dark = idsFor("dark mode");
    expect(dark).toContain("section.appearance");
    expect(dark.indexOf("appearance.theme")).toBeLessThan(dark.indexOf("section.appearance"));
  });

  it("deduplicates repeated destinations and stays stable", () => {
    const first = idsFor("backup");
    const second = idsFor("backup");
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });

  it("returns no results for a blank or whitespace-only query", () => {
    expect(idsFor("")).toEqual([]);
    expect(idsFor("   ")).toEqual([]);
  });

  it("matches localized labels, aliases, and CJK text", () => {
    expect(idsFor("字体大小", "zh")).toContain("appearance.fontSize");
    expect(idsFor("深色模式", "zh")).toContain("appearance.theme");
    expect(idsFor("振动", "zh")).toContain("general.hapticsEnabled");
    expect(idsFor("语音转文字", "zh")).toContain("audioTranscription.models");
    expect(idsFor("índice", "es").length).toBeGreaterThanOrEqual(0);
    expect(idsFor("Einstellungen", "de").length).toBeGreaterThanOrEqual(0);
    expect(idsFor("paramètres", "fr").length).toBeGreaterThanOrEqual(0);
    expect(idsFor("設定", "ja").length).toBeGreaterThanOrEqual(0);
  });

  it.each(["zh", "es", "de", "fr", "ja"] as const)(
    "discovers the localized Appearance label and font size in %s",
    (locale) => {
      const dict = DICTIONARIES[locale];
      expect(idsFor(dict["settings.appearance"], locale)).toContain("section.appearance");
      expect(idsFor(dict["settings.fontSize"], locale)).toContain("appearance.fontSize");
      expect(idsFor(dict["settings.theme"], locale)).toContain("appearance.theme");
    },
  );

  it("keeps English fallback terms searchable in non-English interfaces", () => {
    expect(idsFor("font size", "zh")).toContain("appearance.fontSize");
    expect(idsFor("volume buttons", "ja")).toContain("appearance.volumeRocker");
    expect(idsFor("tts", "de")).toContain("tts.enabled");
  });

  it("rebuilds resolved copy when an async dictionary becomes ready", async () => {
    const previousLanguage = useSettingsStore.getState().settings.general.language;
    const before = getLocaleRevision();
    try {
      await loadLocale("zh");
      expect(getLocaleRevision()).toBeGreaterThan(before);
      useSettingsStore.setState((state) => ({
        settings: {
          ...state.settings,
          general: { ...state.settings.general, language: "zh" },
        },
      }));
      // `liveTranslate` reads the dictionary at call time; a stale catalog
      // built before readiness would not find this label.
      const catalog = resolveSettingsSearchCatalog(SETTINGS_SEARCH_ENTRIES, {
        translate: liveTranslate,
        availability: desktop(),
      });
      expect(searchSettings(catalog, "字体大小").map((result) => result.entry.entry.id)).toContain(
        "appearance.fontSize",
      );
      expect(liveTranslate("settings.searchMatch")).toBe("搜索匹配");
    } finally {
      useSettingsStore.setState((state) => ({
        settings: {
          ...state.settings,
          general: { ...state.settings.general, language: previousLanguage },
        },
      }));
    }
  });

  it("translates every localized result label instead of showing a raw key", () => {
    for (const locale of Object.keys(DICTIONARIES) as Array<keyof typeof DICTIONARIES>) {
      for (const result of searchSettings(catalogFor(locale), "settings")) {
        expect(result.entry.label).not.toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
        expect(result.entry.label.trim()).not.toBe("");
      }
    }
  });

  it("omits account, hosted API, and cloud sync destinations in accountless mode", () => {
    const availability = desktop({ cloudAvailable: false });
    for (const query of ["account", "webhooks", "cloud sync", "delete account"]) {
      const ids = idsFor(query, "en", availability);
      expect(ids, query).not.toContain("section.account");
      expect(ids, query).not.toContain("account.profile");
      expect(ids, query).not.toContain("integrations.publicApi");
      expect(ids, query).not.toContain("cloudStorage.sync");
      expect(ids, query).not.toContain("cloudStorage.syncMode");
      expect(ids, query).not.toContain("privacy.deleteAccount");
    }
    // Independent third-party settings remain available without an account.
    expect(idsFor("dropbox", "en", availability)).toContain("cloudStorage.providers");
    expect(idsFor("obsidian", "en", availability)).toContain("integrations.obsidian");
  });

  it("shows account and cloud destinations when Plethora Cloud is available", () => {
    const availability = desktop({ cloudAvailable: true });
    expect(idsFor("subscription", "en", availability)).toContain("account.profile");
    expect(idsFor("webhooks", "en", availability)).toContain("integrations.publicApi");
  });

  it("omits platform-gated destinations on unsupported platforms", () => {
    const ios = desktop({ platform: "ios", appUpdaterAvailable: false, browserExtensionAvailable: false, notebooklmAvailable: false });
    expect(idsFor("check for updates", "en", ios)).not.toContain("general.updates");
    expect(idsFor("browser extension", "en", ios)).not.toContain("integrations.browserExtension");
    expect(idsFor("notebooklm", "en", ios)).not.toContain("integrations.notebooklm");
    expect(idsFor("android voice", "en", ios)).not.toContain("tts.androidModels");
  });

  it("keeps recoverable setup destinations available", () => {
    expect(idsFor("enable indexing")).toContain("embeddings.index");
    expect(idsFor("groq api key")).toContain("audioTranscription.apiConfig");
  });
});

describe("Settings search catalog integrity", () => {
  it("has unique entry ids and target ids", () => {
    const ids = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id);
    const targets = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.targetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("covers every section in the shared metadata", () => {
    for (const section of SETTINGS_SECTION_METADATA) {
      const entry = findSettingsSearchEntry(`section.${section.id}`);
      expect(entry, section.id).toBeDefined();
      expect(entry?.section).toBe(section.id);
      expect(entry?.label).toEqual({ key: section.labelKey });
    }
  });

  it("references only valid sections", () => {
    const valid = new Set<string>(Object.values(SettingsTab));
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      expect(valid.has(entry.section), entry.id).toBe(true);
    }
  });

  it("derives section entries from shared metadata rather than a duplicate list", () => {
    const sectionEntries = SETTINGS_SEARCH_ENTRIES.filter((entry) => entry.kind === "section");
    expect(sectionEntries.map((entry) => entry.section).sort()).toEqual(
      SETTINGS_SECTION_METADATA.map((section) => section.id).sort(),
    );
  });

  it("does not expose private configuration values or user content", () => {
    const serialized = JSON.stringify(SETTINGS_SEARCH_ENTRIES);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(serialized).not.toMatch(/gsk_[A-Za-z0-9]/);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/blob:|storage:/i);
  });

  it("resolves every entry in English without a raw translation key", () => {
    const availability = desktop({
      cloudAvailable: true,
      companionEnabled: true,
      fsrsEnabled: true,
      daqeEnabled: true,
      ttsProvider: "fal",
    });
    const catalog = catalogFor("en", availability);
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      if (!isSettingsSearchEntryAvailable(entry, availability)) continue;
      const resolved = catalog.find((candidate) => candidate.entry.id === entry.id);
      expect(resolved, entry.id).toBeDefined();
      expect(resolved?.label.length).toBeGreaterThan(0);
      expect(resolved?.label).not.toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
    }
  });

  it("uses the same availability snapshot builder as the UI gates", () => {
    const snapshot = createSettingsSearchAvailabilitySnapshot();
    expect(typeof snapshot.cloudAvailable).toBe("boolean");
    expect(["ios", "android", "desktop", "web"]).toContain(snapshot.platform);
    const account = findSettingsSearchEntry("account.profile")!;
    expect(isSettingsSearchEntryAvailable(account, { ...snapshot, cloudAvailable: false })).toBe(false);
    expect(isSettingsSearchEntryAvailable(account, { ...snapshot, cloudAvailable: true })).toBe(true);
  });
});
