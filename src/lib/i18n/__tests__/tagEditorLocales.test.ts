import { describe, it, expect } from "vitest";
import { en } from "../locales/en";
import { de } from "../locales/de";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { ja } from "../locales/ja";
import { zh } from "../locales/zh";

/**
 * Locale coverage for the shared tag editor (openspec task 6.1). All new
 * user-visible strings must exist in every supported locale so the fallback
 * (dict[key] || en[key] || key) never silently shows a raw key in a
 * non-English UI.
 */
const LOCALES = { en, de, es, fr, ja, zh };

const REQUIRED_KEYS = [
  // Shared editor (inline + compact)
  "itemDetails.addTagPlaceholder",
  "itemDetails.addTag",
  "itemDetails.removeTag",
  "itemDetails.viewItemsWithTag",
  "itemDetails.tagAddFailed",
  "itemDetails.tagRemoveFailed",
  "itemDetails.pleaseTryAgain",
  "tagEditor.editTags",
  "tagEditor.editTagsTitle",
  // Schedule grid alignment
  "schedule.gridHeaderLabel",
  "schedule.gridDetailLabel",
];

describe("tag-editor locale coverage (6.1)", () => {
  it.each(Object.keys(LOCALES))("$locale defines every shared-editor string", (locale) => {
    const dict = LOCALES[locale as keyof typeof LOCALES];
    for (const key of REQUIRED_KEYS) {
      expect(typeof dict[key], `${locale} missing "${key}"`).toBe("string");
      expect(dict[key].length, `${locale} empty "${key}"`).toBeGreaterThan(0);
    }
  });

  it("English values are non-placeholder, human-readable strings", () => {
    expect(en["tagEditor.editTags"]).not.toContain("{count} missing");
    expect(en["itemDetails.removeTag"]).toContain("{tag}"); // template var kept
    expect(en["schedule.gridDetailLabel"].length).toBeGreaterThan(10);
  });
});
