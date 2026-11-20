import { describe, expect, it } from "vitest";
import type { Theme } from "../../types/theme";
import {
  isAnimatedImageTheme,
  sanitizeImportedTheme,
  serializeThemeForExport,
} from "../themePortability";

const MEDIA_ID = "anim-00000000-0000-4000-8000-000000000001";
const MEDIA_KEY = `media:v1:${MEDIA_ID}:poster`;
const SAFE_THUMBNAIL = "data:image/png;base64,iVBORw0KGgo=";

function makeTheme(id = "importable-theme"): Theme {
  return {
    id,
    name: "Importable theme",
    variant: "dark",
    colors: {} as Theme["colors"],
    typography: {} as Theme["typography"],
    spacing: {} as Theme["spacing"],
    radius: {} as Theme["radius"],
    shadows: {} as Theme["shadows"],
    effects: {
      backgroundImage: { imageId: MEDIA_KEY, thumbnailDataUrl: SAFE_THUMBNAIL },
      imageAnimation: { version: 1, mediaId: MEDIA_ID, sourceFormat: "gif", enabled: true },
    },
  };
}

describe("theme image portability", () => {
  it("exports animated image themes as labeled colors-only JSON", () => {
    const exported = JSON.parse(serializeThemeForExport(makeTheme()));

    expect(exported.plethoraExport).toEqual({ version: 1, background: "colors-only" });
    expect(exported.effects?.backgroundImage).toBeUndefined();
    expect(exported.effects?.imageAnimation).toBeUndefined();
    expect(JSON.stringify(exported)).not.toContain(MEDIA_ID);
    expect(JSON.stringify(exported)).not.toContain(SAFE_THUMBNAIL);
  });

  it("keeps legacy still-image export fields and strips imported local media handles", () => {
    const still = makeTheme();
    delete still.effects?.imageAnimation;
    still.effects!.backgroundImage!.imageId = "img-legacy-1";
    const legacyExport = JSON.parse(serializeThemeForExport(still));
    expect(legacyExport.effects.backgroundImage.imageId).toBe("img-legacy-1");
    expect(legacyExport.plethoraExport).toBeUndefined();

    const imported = sanitizeImportedTheme(makeTheme(), []);
    expect(imported.effects?.imageAnimation).toBeUndefined();
    expect(imported.effects?.backgroundImage).toEqual({
      imageId: "",
      thumbnailDataUrl: SAFE_THUMBNAIL,
    });
  });

  it("rejects remote media URLs and drops malformed or oversized thumbnails", () => {
    const remote = makeTheme();
    remote.effects!.backgroundImage!.imageId = "https://example.invalid/image.png";
    expect(() => sanitizeImportedTheme(remote, [])).toThrow(/remote image references/i);

    const malformed = makeTheme();
    malformed.effects!.backgroundImage!.thumbnailDataUrl = "data:image/png;base64,AAAA";
    expect(sanitizeImportedTheme(malformed, []).effects?.backgroundImage).toBeUndefined();

    const oversized = makeTheme();
    oversized.effects!.backgroundImage!.thumbnailDataUrl =
      `data:image/png;base64,${"A".repeat(44_000)}`;
    expect(sanitizeImportedTheme(oversized, []).effects?.backgroundImage).toBeUndefined();
  });

  it("assigns a fresh ID when imported JSON collides with a saved animated theme", () => {
    const existing = makeTheme("shared-theme-id");
    const imported = sanitizeImportedTheme(makeTheme("shared-theme-id"), [existing]);

    expect(imported.id).not.toBe(existing.id);
    expect(imported.effects?.imageAnimation).toBeUndefined();
    expect(isAnimatedImageTheme(existing)).toBe(true);
    expect(isAnimatedImageTheme(imported)).toBe(false);
  });
});
