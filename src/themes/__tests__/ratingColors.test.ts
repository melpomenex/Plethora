import { describe, expect, it } from "vitest";
import { builtInThemes } from "../builtin";
import { contrastRatio, parseColor } from "../color";
import { deriveMaterialRoles } from "../materialRoles";
import { resolveRatingColors } from "../ratingColors";

describe("rating color pairs", () => {
  it("keeps dock and grade text readable across the complete built-in catalog", () => {
    for (const theme of builtInThemes) {
      const pairs = resolveRatingColors(theme.colors, theme.variant, deriveMaterialRoles(theme.colors, theme.variant));
      for (const role of ["surface", "again", "hard", "good", "easy", "dismiss"]) {
        expect(contrastRatio(parseColor(pairs[`rating-${role}`])!, parseColor(pairs[`on-rating-${role}`])!), `${theme.id}: ${role}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("supports invalid, translucent and low-contrast imported colors without new fields", () => {
    const colors = { ...builtInThemes[0].colors, surfaceContainerHigh: "rgba(255,0,255,0.5)", onSurface: "#ff00ff", error: "invalid", warning: "#ffffff", primary: "#ff00ff", success: "#ff00ff" };
    const pairs = resolveRatingColors(colors, "light", {});
    for (const role of ["surface", "again", "hard", "good", "easy", "dismiss"]) {
      expect(contrastRatio(parseColor(pairs[`rating-${role}`])!, parseColor(pairs[`on-rating-${role}`])!)).toBeGreaterThanOrEqual(4.5);
      expect(parseColor(pairs[`rating-${role}`])!.a).toBe(1);
    }
  });
});
