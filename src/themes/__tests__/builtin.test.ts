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
});
