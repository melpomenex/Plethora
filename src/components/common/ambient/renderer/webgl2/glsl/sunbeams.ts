/**
 * Effect: sunbeams
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: 4 rotating light wedges in angle space (a few sin/atan per pixel)
 * plus one glow() — cheap fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const sunbeamsEffect: WebGLEffect = {
  id: "sunbeams",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = uv * vec2(uAspect, 1.0);
  float t = uTime * 0.3; // legacy 0.005/frame ≈ 0.15/s

  // Light source just above the top-left corner, as in the Canvas2D version.
  vec2 o = vec2(0.1 * uAspect, 1.06);
  vec2 q = p - o;
  float dist = length(q);
  float ang = atan(-q.y, q.x); // 0 = right, positive = downward

  vec3 col = uPalette[3]; // dusk base
  col += uPalette[1] * glow(o, p, 0.55) * 0.25; // warm halo at the source

  float w = 1.0 + 0.15 * d;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float a1 = 0.12 + fi * 0.22 + sin(t + fi * 2.0) * 0.08;
    float a2 = a1 + 0.16 + sin(t * 0.7 + fi) * 0.05;
    float m = smoothstep(a1, a1 + 0.05, ang) * (1.0 - smoothstep(a2 - 0.05, a2, ang));
    float fade = exp(-dist * 1.4);
    float flicker = 0.30 + 0.08 * sin(t * 1.2 + fi);
    col += uPalette[0] * m * fade * flicker * w;
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#ffe696", "#fff3c8", "#e8b858", "#141c2a"],
};
