/**
 * Effect: plasma
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: classic four-sine interference field (~5 sin + 3 palette mixes per
 * pixel) — one cheap fullscreen pass, no noise lookups.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const plasmaEffect: WebGLEffect = {
  id: "plasma",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);

  // Legacy field coords: x*0.05/px at quarter res is roughly 10 across the
  // half-height; density tightens the interference slightly.
  vec2 f = (uv - 0.5) * vec2(uAspect, 1.0) * (10.0 + 2.0 * d);
  float t = uTime * 0.6; // legacy 0.02/frame at ~30 fps

  // Classic four-sine plasma: x, y, x+y, and a radial term.
  float v = sin(f.x * 0.9 + t)
          + sin(f.y * 0.9 + t * 0.7)
          + sin((f.x + f.y) * 0.55 + t * 0.5)
          + sin(length(f + vec2(3.0, 2.0)) * 0.7);

  // Legacy channels are periodic with period 2 and even in v — fold to 0..1.
  float x = mod(abs(v), 2.0);
  x = min(x, 2.0 - x);

  // The legacy channel triple sampled at v = 0 / 0.5 / 1 / 1.5:
  // olive, ember red, deep blue, royal blue.
  vec3 col = paletteMix(uPalette[0], uPalette[1], x * 3.0);
  col = paletteMix(col, uPalette[2], x * 3.0 - 1.0);
  col = paletteMix(col, uPalette[3], x * 3.0 - 2.0);

  // Legacy drew at ~24% alpha; keep the same dim feel over a dark base.
  vec3 base = mix(uPalette[0], uPalette[2], 0.5) * 0.06;
  col = base + col * 0.34;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#3c5612", "#781a1a", "#000484", "#00407c"],
};
