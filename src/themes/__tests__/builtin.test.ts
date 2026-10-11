import { describe, expect, it } from "vitest";
import { builtInThemes } from "../builtin";

describe("builtInThemes", () => {
  it("liquid glass themes have correct transparent/translucent layout wrapper customCSS rules", () => {
    const targetThemeIds = ["liquid-glass", "amber-liquid-glass", "rose-liquid-glass"];
    const targetThemes = builtInThemes.filter((t) => targetThemeIds.includes(t.id));

    expect(targetThemes).toHaveLength(3);

    for (const theme of targetThemes) {
      expect(theme.customCSS).toBeDefined();
      const css = theme.customCSS || "";

      // Should have transparency rules for app-shell
      expect(css).toContain(`.app-shell {`);
      expect(css).toContain(`background: rgba(`);
      expect(css).toContain(`!important;`);

      // Should have transparent rules for other layout wrappers
      expect(css).toContain(`.bg-background:not(.app-shell),`);
      expect(css).toContain(`.main-content,`);
      expect(css).toContain(`.bg-cream {`);
      expect(css).toContain(`background: transparent !important;`);
    }
  });

  it("all built-in animated themes define customCSS with shell and layout transparency", () => {
    const animated = builtInThemes.filter((t) => Boolean(t.effects?.backgroundAnimation));
    expect(animated.length).toBeGreaterThan(0);

    for (const theme of animated) {
      expect(theme.customCSS, `Theme ${theme.id} should have customCSS`).toBeDefined();
      const css = theme.customCSS || "";
      expect(css, `Theme ${theme.id} should have app-shell rule`).toContain(".app-shell");
      expect(css, `Theme ${theme.id} should have bg-background:not(.app-shell) rule`).toContain(
        ".bg-background:not(.app-shell)",
      );
      expect(css, `Theme ${theme.id} should have main-content rule`).toContain(".main-content");
    }
  });
});
