/**
 * Settings search benchmark (change: improve-settings-search, task 8.2).
 *
 * Measures the pure matcher over (a) the real resolved catalog and (b) a
 * seeded synthetic catalog of 1,000 entries. Inputs come from `seededRandom`,
 * results feed a module-level sink so the engine cannot elide the work, and
 * every benchmark body returns void.
 */

import { bench } from "vitest";
import { seededRandom } from "../../../test/bench-support";
import { en } from "../../../lib/i18n/locales/en";
import { SettingsTab } from "../settingsSections";
import {
  SETTINGS_SEARCH_ENTRIES,
  type SettingsSearchAvailabilitySnapshot,
  type SettingsSearchEntry,
} from "./settingsSearchCatalog";
import {
  resolveSettingsSearchCatalog,
  searchSettings,
  type ResolvedSettingsSearchEntry,
} from "./settingsSearch";

const availability: SettingsSearchAvailabilitySnapshot = {
  cloudAvailable: false,
  platform: "desktop",
  appUpdaterAvailable: true,
  browserExtensionAvailable: true,
  notebooklmAvailable: true,
  onDeviceAiAvailable: false,
  companionEnabled: true,
  fsrsEnabled: true,
  daqeEnabled: true,
  ttsProvider: "fal",
};

const translate = (key: string): string => en[key] ?? key;

/** Consumed result sink — prevents dead-code elimination of the match. */
let sink: readonly unknown[] = [];

const REAL_CATALOG: readonly ResolvedSettingsSearchEntry[] = resolveSettingsSearchCatalog(
  SETTINGS_SEARCH_ENTRIES,
  { translate, availability },
);

const SYNTHETIC_CATALOG: readonly ResolvedSettingsSearchEntry[] = (() => {
  const random = seededRandom(0x5eed);
  const words = [
    "font", "size", "theme", "dark", "mode", "volume", "buttons", "speech",
    "text", "voice", "provider", "model", "backup", "storage", "privacy",
    "network", "reader", "display", "layout", "learning", "review", "queue",
    "index", "embedding", "language", "profile", "notification", "sound",
  ];
  const entries: SettingsSearchEntry[] = Array.from({ length: 1000 }, (_, index) => {
    const word = () => words[Math.floor(random() * words.length)]!;
    const label = `${word()} ${word()} ${index}`;
    return {
      id: `synthetic.${index}`,
      kind: index % 5 === 0 ? "group" : "setting",
      section: SettingsTab.General,
      label: { text: label },
      groupPath: [{ text: `${word()} group` }],
      aliases: [{ text: `${word()} ${word()}` }],
      description: { text: `${word()} ${word()} ${word()} synthetic entry ${index}` },
      keywords: [word(), word()],
      targetId: `synthetic.target.${index}`,
    } satisfies SettingsSearchEntry;
  });
  return resolveSettingsSearchCatalog(entries, { translate, availability });
})();

bench("settings-search/real-catalog", () => {
  sink = searchSettings(REAL_CATALOG, "font size");
  void sink;
});

bench("settings-search/synthetic-1000", () => {
  sink = searchSettings(SYNTHETIC_CATALOG, "font size");
  void sink;
});

bench("settings-search/synthetic-1000-typo", () => {
  sink = searchSettings(SYNTHETIC_CATALOG, "font siez");
  void sink;
});
