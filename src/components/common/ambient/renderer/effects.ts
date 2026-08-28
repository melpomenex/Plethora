/**
 * Effect registry: the single source of truth mapping a theme's
 * `effects.backgroundAnimation` id to its renderer capabilities.
 *
 * Lookup preserves the original ThemeBackdrop semantics: exact match first,
 * then a bidirectional prefix match for backwards compatibility (e.g. custom
 * themes referencing shortened ids). Ids that resolve to nothing (liquid-glow)
 * intentionally have no renderer — those themes animate purely through CSS.
 */
import type { AnimFn, WebGLEffect } from "./types";
import { LEGACY_EFFECTS } from "./canvas2d/legacyEffects";
import { WEBGL_EFFECTS } from "./webgl2/glsl";

export type RendererPreference = "auto" | "gpu" | "canvas";

export interface EffectDefinition {
  id: string;
  /** Legacy Canvas2D implementation (also the fallback for webgl effects). */
  canvas2d?: AnimFn;
  /** WebGL2 fragment-shader implementation, when GPU rendering is a win. */
  webgl?: WebGLEffect;
  /**
   * Whether ANY static single frame may be drawn when motion is unavailable
   * (reduced motion / animations disabled): true for the jellyfish family
   * (Canvas2D honors staticOnly) and for every WebGL effect (one shader frame).
   */
  supportsStatic: boolean;
  /**
   * Whether the Canvas2D implementation itself renders statically. Only the
   * jellyfish AnimFn reads `staticOnly`; every other legacy effect would
   * immediately start its RAF loop, so the Canvas2D fallback path must refuse
   * to run them in static mode.
   */
  canvas2dStatic: boolean;
  /** Hint for backend choice; "canvas" effects keep Canvas2D even with WebGL2. */
  rendererPreference: RendererPreference;
}

function buildRegistry(): Record<string, EffectDefinition> {
  const registry: Record<string, EffectDefinition> = {};
  for (const [id, canvas2d] of Object.entries(LEGACY_EFFECTS)) {
    registry[id] = {
      id,
      canvas2d,
      supportsStatic: id === "jellyfish",
      canvas2dStatic: id === "jellyfish",
      rendererPreference: "canvas",
    };
  }
  for (const effect of WEBGL_EFFECTS) {
    const entry = registry[effect.id];
    if (entry) {
      entry.webgl = effect;
      entry.rendererPreference = "gpu";
      entry.supportsStatic = true;
    } else {
      registry[effect.id] = {
        id: effect.id,
        webgl: effect,
        supportsStatic: true,
        canvas2dStatic: false,
        rendererPreference: "gpu",
      };
    }
  }
  return registry;
}

export const EFFECT_REGISTRY: Record<string, EffectDefinition> = buildRegistry();

/** Exact match, then bidirectional prefix match (legacy behavior). */
export function findEffect(animation: string): EffectDefinition | null {
  const exact = EFFECT_REGISTRY[animation];
  if (exact) return exact;
  const keys = Object.keys(EFFECT_REGISTRY);
  const match = keys.find((k) => k.startsWith(animation) || animation.startsWith(k));
  return match ? EFFECT_REGISTRY[match] : null;
}

/** Whether the effect should run through WebGL2 when the backend is available. */
export function prefersGpu(effect: EffectDefinition): boolean {
  return effect.rendererPreference !== "canvas" && typeof effect.webgl !== "undefined";
}
