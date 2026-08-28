/**
 * Effect: bioglow
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: 3 hashed spore layers (3x3 cells each, 27 cheap iterations of
 * exp/sin) — moderate fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const bioglowEffect: WebGLEffect = {
  id: "bioglow",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime * 0.6;

  // Abyssal teal base, slightly brighter overhead.
  vec3 col = uPalette[3] + uPalette[0] * 0.03 * uv.y;

  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float cells = 6.0 + 4.0 * fl;
    vec2 gp = vec2(p.x, p.y - t * (0.012 + 0.010 * fl)) * cells;
    vec2 baseId = floor(gp);
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 id = baseId + vec2(float(i), float(j));
        vec2 h = hash22(id + vec2(0.0, 23.0 * fl));
        float present = step(h.x, 0.4 + 0.13 * d);
        vec2 pos = id + 0.25 + 0.5 * h;
        pos.x += sin(t * 0.5 + h.y * 6.2831) * 0.18; // legacy sway
        vec2 dd = gp - pos;
        float q = dot(dd, dd);
        float pulse = 0.5 + 0.5 * sin(t * 1.8 + h.y * 6.2831);
        float halo = exp(-q * 12.0); // legacy r*3 radial glow
        float core = exp(-q * 60.0); // bright spore center
        vec3 tint = uPalette[int(h.y * 2.999)];
        col += tint * (halo * 0.22 + core * 0.40) * pulse * present;
      }
    }
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#00f0ff", "#00ffb4", "#64b4ff", "#03262b"],
};
