import { describe, expect, it } from "vitest";
import { EFFECT_REGISTRY, findEffect, prefersGpu } from "../effects";
import { LEGACY_EFFECTS } from "../canvas2d/legacyEffects";
import { WEBGL_EFFECTS } from "../webgl2/glsl";

/** The 39 legacy Canvas2D effect ids shipped by ThemeBackdrop before the refactor. */
const LEGACY_IDS = [
  "rain", "deepspace", "snowfall", "fireflies", "aurora", "digitalrain", "neongrid",
  "underwater", "cherryblossom", "starwarp", "ember", "nebula", "confetti", "campfire",
  "oceanwaves", "plasma", "alien", "lightning", "sandstorm", "hologram", "meteorshower",
  "pixelrain", "synthsun", "toxicrain", "fairydust", "comettrail", "lavalamp",
  "electricarc", "galaxy", "glitch", "firewall", "northern", "sunbeams", "dandelions",
  "rainywindow", "cyberhighway", "cosmicdust", "bioglow", "jellyfish",
];

const MIGRATED_IDS = [
  "plasma", "aurora", "nebula", "oceanwaves", "northern", "underwater", "sunbeams",
  "synthsun", "lavalamp", "cosmicdust", "bioglow", "starwarp", "jellyfish",
];

describe("EFFECT_REGISTRY", () => {
  it("contains every legacy id", () => {
    for (const id of LEGACY_IDS) {
      expect(EFFECT_REGISTRY[id], `missing ${id}`).toBeDefined();
    }
    expect(Object.keys(LEGACY_EFFECTS).sort()).toEqual([...LEGACY_IDS].sort());
  });

  it("leaves CSS-only effects unresolved", () => {
    expect(findEffect("liquid-glow")).toBeNull();
    expect(findEffect("does-not-exist")).toBeNull();
  });

  it("keeps the legacy prefix fallback", () => {
    expect(findEffect("jelly")?.id).toBe("jellyfish");
    expect(findEffect("rain")?.id).toBe("rain");
  });

  it("marks Canvas2D-static support only for jellyfish; webgl effects via GPU", () => {
    for (const id of LEGACY_IDS) {
      const effect = EFFECT_REGISTRY[id];
      if (id === "jellyfish" || effect.webgl) {
        expect(effect.supportsStatic, `${id}`).toBe(true);
      } else {
        expect(effect.supportsStatic, `${id}`).toBe(false);
      }
    }
  });

  it("registers every migrated effect as GPU-preferred with static support", () => {
    expect(WEBGL_EFFECTS.map((e) => e.id).sort()).toEqual([...MIGRATED_IDS].sort());
    for (const id of MIGRATED_IDS) {
      const effect = EFFECT_REGISTRY[id];
      expect(effect.webgl, `${id} webgl impl`).toBeDefined();
      expect(effect.rendererPreference, `${id}`).toBe("gpu");
      expect(effect.supportsStatic, `${id}`).toBe(true);
      expect(prefersGpu(effect), `${id}`).toBe(true);
    }
  });

  it("keeps particle-shaped effects on Canvas2D", () => {
    for (const id of ["rain", "snowfall", "confetti", "digitalrain", "rainywindow"]) {
      expect(prefersGpu(EFFECT_REGISTRY[id]), `${id}`).toBe(false);
      expect(EFFECT_REGISTRY[id].webgl).toBeUndefined();
    }
  });

  it("preserves a Canvas2D fallback for every migrated effect", () => {
    for (const id of MIGRATED_IDS) {
      expect(EFFECT_REGISTRY[id].canvas2d, `${id} canvas2d fallback`).toBeDefined();
    }
  });
});
