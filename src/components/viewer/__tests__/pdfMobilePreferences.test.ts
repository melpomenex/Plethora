import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings } from "../../../stores/settingsStore";
import { loadPdfMobilePreferences, pdfMobilePreferencesFromSettings, savePdfMobilePreferences } from "../pdfMobilePreferences";

describe("per-document mobile PDF preferences", () => {
  beforeEach(() => localStorage.clear());

  it("starts from global defaults and persists document overrides independently", () => {
    const defaults = pdfMobilePreferencesFromSettings(defaultSettings.documents.pdfSettings);
    expect(loadPdfMobilePreferences("a", defaults).reflowFontSize).toBe(19);
    savePdfMobilePreferences("a", { ...defaults, reflowFontSize: 24, preferredMobileMode: "reflow" });
    expect(loadPdfMobilePreferences("a", defaults)).toMatchObject({ reflowFontSize: 24, preferredMobileMode: "reflow" });
    expect(loadPdfMobilePreferences("b", defaults)).toEqual(defaults);
  });
});
