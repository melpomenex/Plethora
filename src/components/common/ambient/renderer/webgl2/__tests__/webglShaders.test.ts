import { describe, expect, it } from "vitest";
import { GLSL_PRELUDE } from "../glsl/common";
import { WEBGL_EFFECTS } from "../glsl";

/**
 * Shader source contracts. jsdom cannot compile GLSL; these checks catch the
 * failure classes that survive to runtime: wrong version, redeclared prelude
 * symbols, missing main, non-opaque output, palette length drift, and id
 * mismatches with the registry.
 */
describe("webgl2 shader sources", () => {
  it("exposes a non-empty effect set", () => {
    expect(WEBGL_EFFECTS.length).toBeGreaterThanOrEqual(13);
  });

  for (const effect of WEBGL_EFFECTS) {
    it(`${effect.id}: compiles against the contract`, () => {
      const src = effect.fragment;
      expect(src.startsWith("#version 300 es")).toBe(true);
      expect(src).toContain("void main()");
      expect(src.match(/void\s+main\s*\(/g)).toHaveLength(1);
      // Output must be opaque and assigned.
      expect(src).toContain("fragColor");
      expect(src).not.toMatch(/fragColor\s*=\s*[^;]*,\s*(0\.0|alpha)\s*\)/);
      // Prelude symbols are provided exactly once by the prelude — a shader
      // redeclaring any of them fails to compile.
      for (const symbol of [
        "uniform float uTime",
        "uniform vec2 uResolution",
        "uniform float uDensity",
        "uniform float uAspect",
        "uniform vec3 uPalette",
        "out vec4 fragColor",
        "precision highp float",
      ]) {
        const occurrences = src.split(symbol).length - 1;
        expect(occurrences, `"${symbol}" appears ${occurrences}x`).toBe(
          GLSL_PRELUDE.split(symbol).length - 1,
        );
      }
      // No textures, no attributes (bufferless fullscreen triangle).
      expect(src).not.toContain("texture(");
      expect(src).not.toContain("attribute ");
      expect(src).not.toContain("in vec3");
      expect(src).not.toContain("in vec2");
      // Balanced braces.
      expect(src.split("{").length).toBe(src.split("}").length);
      // Palette contract: 4–6 hex entries.
      expect(effect.palette.length).toBeGreaterThanOrEqual(4);
      expect(effect.palette.length).toBeLessThanOrEqual(6);
      for (const hex of effect.palette) {
        expect(hex).toMatch(/^#?[0-9a-fA-F]{6}$/);
      }
    });

    it(`${effect.id}: id matches the module contract`, () => {
      expect(effect.id).toMatch(/^[a-z][a-z0-9]*$/);
      expect(WEBGL_EFFECTS.filter((e) => e.id === effect.id)).toHaveLength(1);
    });
  }

  it("jellyfish resolves its palette from the theme registry", () => {
    const jelly = WEBGL_EFFECTS.find((e) => e.id === "jellyfish");
    expect(jelly?.resolvePalette).toBeDefined();
    const defaultPalette = jelly!.resolvePalette!(undefined);
    expect(defaultPalette.length).toBe(6);
    const themed = jelly!.resolvePalette!("bioluminescent-flow");
    expect(themed.length).toBe(6);
    expect(themed).not.toEqual(defaultPalette);
  });
});
