import { describe, expect, it } from "vitest";
import { legacyIndexThemes } from "../legacyIndex";

describe("legacyIndex animated themes", () => {
  const animatedThemes = legacyIndexThemes.filter((t) => Boolean(t.effects?.backgroundAnimation));

  it("registers 32 animated legacy themes including starfield and lava lamp", () => {
    expect(animatedThemes).toHaveLength(32);

    const starfield = legacyIndexThemes.find((t) => t.id === "starwarp");
    expect(starfield).toBeDefined();
    expect(starfield?.effects?.backgroundAnimation).toBe("starwarp");

    const lavalamp = legacyIndexThemes.find((t) => t.id === "lavalamp");
    expect(lavalamp).toBeDefined();
    expect(lavalamp?.effects?.backgroundAnimation).toBe("lavalamp");
  });

  it("provides customCSS with shell and layout transparency for starfield and lava lamp", () => {
    for (const themeId of ["starwarp", "lavalamp"]) {
      const theme = legacyIndexThemes.find((t) => t.id === themeId);
      expect(theme).toBeDefined();
      const css = theme?.customCSS ?? "";

      expect(css).toContain(`.app-shell,`);
      expect(css).toContain(`.bg-background:not(.app-shell),`);
      expect(css).toContain(`.main-content,`);
      expect(css).toContain(`.bg-cream {`);
      expect(css).toContain(`background: transparent !important;`);
      expect(css).toContain(`background-color: transparent !important;`);
      expect(css).toContain(`.bg-card,`);
      expect(css).toContain(`backdrop-filter: blur(12px);`);
      // Crucial: ensure raw .bg-background is NOT matching the shell or tab container
      expect(css).not.toMatch(/\.bg-background\s*,/);
    }
  });

  it("all 32 animated legacy themes emit transparency rules without polluting .bg-background", () => {
    for (const theme of animatedThemes) {
      const css = theme.customCSS ?? "";
      expect(css).toContain(`.app-shell,`);
      expect(css).toContain(`.bg-background:not(.app-shell),`);
      expect(css).toContain(`.main-content,`);
      expect(css).toContain(`background: transparent !important;`);
      expect(css).toContain(`backdrop-filter: blur(12px);`);
      expect(css).not.toMatch(/\.bg-background\s*,/);
    }
  });
});
