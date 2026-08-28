/**
 * Effect: aurora
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: three filled sine curtains (2 sin each) plus one shared 4-octave fbm
 * for striations — cheap fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const auroraEffect: WebGLEffect = {
  id: "aurora",
  fragment: `${GLSL_PRELUDE}
// One curtain: soft fill from a wavy top edge downward (Y up).
float curtain(vec2 p, float t, float yBase, float phase) {
  float edge = yBase - (sin(p.x * 2.4 + t + phase) * 0.05
                      + sin(p.x * 5.6 + t * 1.5) * 0.025);
  float h = edge - p.y; // > 0 below the edge
  return smoothstep(0.0, 0.03, h) * exp(-max(h, 0.0) * 2.2);
}

void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = uv * vec2(uAspect, 1.0);
  float t = uTime * 0.35; // legacy 0.005/frame at ~30 fps

  // Shared vertical striation field gives the curtains their ray structure.
  float st = fbm(vec2(p.x * 6.0, t * 0.3));

  vec3 col = uPalette[3] * 0.9; // night base
  float w = 0.34 + 0.05 * d;
  col += uPalette[0] * curtain(p, t, 0.85, 0.0) * w * (0.6 + 0.8 * st);
  col += uPalette[1] * curtain(p, t, 0.78, 2.0) * w * (0.7 + 0.6 * st);
  col += uPalette[2] * curtain(p, t, 0.71, 4.0) * w * (0.65 + 0.7 * st);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#28dca0", "#5078dc", "#a03cc8", "#0a1524"],
};
