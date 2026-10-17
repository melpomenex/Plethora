import { describe, expect, it } from "vitest";
import { legalPadTheme } from "../legalPad";
import { PAPER_PRESET_ID } from "../materials";
import { resolveThemeAppearance, resolvePaperMaterial } from "../resolveThemeAppearance";
import { paperReaderCss } from "../paperMaterialCss";
import { modernDarkTheme } from "../builtin";

describe("paper appearance policy", () => {
  it("caps DPR and resources without mutating preferences", () => {
    const prefs = {
      [PAPER_PRESET_ID]: { detail: "maximum" as const, ruling: false, margin: true },
    };
    const p = resolvePaperMaterial(legalPadTheme, prefs, {
      dpr: 8,
      deviceMemory: 4,
      baseUrl: "https://app.invalid/",
    });
    expect(p.grainUrl).toBe(
      "https://app.invalid/theme-materials/legal-pad/v1/grain-subtle-1024.webp"
    );
    expect(p.effectiveDetail).toBe("subtle");
    expect(p.requestedDetail).toBe("maximum");
    expect(p.margin).toBe(false);
    expect(prefs[PAPER_PRESET_ID].margin).toBe(true);
  });
  it("falls back once then retains a usable flat palette", () => {
    expect(
      resolveThemeAppearance(legalPadTheme, {}, { assetFailure: "webp" }).paper.grainUrl
    ).toMatch(/fallback-512.png$/);
    const plain = resolveThemeAppearance(legalPadTheme, {}, { assetFailure: "png" });
    expect(plain.paper).toBeNull();
    expect(plain.readerTokens.background).toBe("#f5df85");
  });
  it("projects accessibility to frames and never certifies HDR from screen hints", () => {
    const eink = resolveThemeAppearance(legalPadTheme, {}, { eink: true });
    expect(eink.paper).toBeNull();
    expect(eink.readerTokens.foreground).toBe("#000000");
    expect(paperReaderCss(eink)).toContain("CanvasText");
    expect(resolveThemeAppearance(legalPadTheme).paper.displayTier).toBe("srgb");
    expect(resolveThemeAppearance(modernDarkTheme).paper).toBeNull();
    expect(resolveThemeAppearance(legalPadTheme, {}, { highContrast: true }).paper).toBeNull();
  });
  it("serializes trusted absolute assets without changing content or applying media filters", () => {
    const css = paperReaderCss(
      resolveThemeAppearance(legalPadTheme, {}, { baseUrl: "https://app.invalid/app" })
    );
    expect(css).toContain("https://app.invalid/theme-materials/");
    expect(css).not.toMatch(/filter:|canvas|requestAnimationFrame|body \*/);
  });
});
