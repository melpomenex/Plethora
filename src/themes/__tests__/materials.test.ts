import { describe, expect, it } from "vitest";
import {
  normalizeMaterialPreferences,
  normalizePaperPreferences,
  normalizeThemeMaterial,
  PAPER_PRESET_ID,
} from "../materials";

describe("paper material data boundary", () => {
  it("discards unsupported presets and arbitrary resource data", () => {
    expect(
      normalizeThemeMaterial({ kind: "paper", preset: "https://example.com/image" })
    ).toBeUndefined();
    expect(normalizeThemeMaterial(null)).toBeUndefined();
    expect(
      normalizeThemeMaterial({ kind: "paper", preset: PAPER_PRESET_ID, url: "https://example.com" })
    ).toEqual({ kind: "paper", preset: PAPER_PRESET_ID });
  });
  it("preserves explicit false while normalizing partial or corrupt settings", () => {
    expect(normalizePaperPreferences({ detail: "bad", ruling: false, margin: null })).toEqual({
      detail: "authentic",
      ruling: false,
      margin: true,
    });
    expect(normalizePaperPreferences(undefined)).toEqual({
      detail: "authentic",
      ruling: true,
      margin: true,
    });
    expect(normalizeMaterialPreferences({ other: { detail: "maximum" } })).toEqual({});
    expect(normalizeMaterialPreferences({ [PAPER_PRESET_ID]: { detail: "subtle" } })).toEqual({
      [PAPER_PRESET_ID]: { detail: "subtle", ruling: true, margin: true },
    });
  });
});
