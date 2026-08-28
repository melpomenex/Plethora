/**
 * Effect: underwater
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: 3 valueNoise taps for caustics + 2 hashed bubble layers (3x3 cells
 * each, ~18 cheap iterations) — moderate fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const underwaterEffect: WebGLEffect = {
  id: "underwater",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime;

  // Blue water column: lighter overhead, abyssal at the bottom.
  vec3 col = mix(uPalette[3], uPalette[2], uv.y);

  // Caustic weave: two noise sheets sliding against each other.
  float c1 = valueNoise(p * 5.0 + vec2(0.0, t * 0.10));
  float c2 = valueNoise(p * 5.0 + vec2(4.7, 3.0 - t * 0.08));
  float caustic = max(c1 * c2, 0.0);
  caustic = caustic * caustic * 2.2;
  col += uPalette[1] * caustic * 0.30 * (uv.y * 0.7 + 0.3);

  // Rising bubbles: two hashed grid layers drifting upward.
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float cells = 7.0 + 5.0 * fl;
    vec2 gp = vec2(p.x, p.y - t * (0.015 + 0.012 * fl)) * cells;
    vec2 baseId = floor(gp);
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 id = baseId + vec2(float(i), float(j));
        vec2 h = hash22(id + vec2(0.0, 17.0 * fl));
        float present = step(h.x, 0.55 + 0.15 * d);
        vec2 pos = id + 0.2 + 0.6 * h;
        pos.x += sin(t * 0.8 + h.y * 6.2831) * 0.15;
        float r = 0.05 + 0.09 * h.x;
        vec2 dd = gp - pos;
        float e = (length(dd) - r) * 16.0;
        float ring = exp(-e * e);       // bubble shell
        float f = (length(dd) - r * 0.35) * 30.0;
        float spark = exp(-f * f);      // legacy highlight dot
        col += (uPalette[0] * ring * 0.35 + uPalette[1] * spark * 0.30)
             * present * (1.0 - fl * 0.35);
      }
    }
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#64c8e6", "#96dcf0", "#0e4a66", "#06283c"],
};
