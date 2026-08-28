/**
 * Effect: cosmicdust
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: 2 hashed particle layers (3x3 cells each, ~18 cheap iterations) —
 * moderate fullscreen pass, no noise textures.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const cosmicdustEffect: WebGLEffect = {
  id: "cosmicdust",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime * 0.4;

  vec3 col = mix(uPalette[1], uPalette[2], 0.5) * 0.05;

  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float cells = 9.0 + 7.0 * fl;
    vec2 gp = p * cells + vec2(t * 0.25, -t * 0.15) * (fl + 1.0);
    vec2 baseId = floor(gp);
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 id = baseId + vec2(float(i), float(j));
        vec2 h = hash22(id + vec2(0.0, 31.0 * fl));
        float present = step(h.x, 0.4 + 0.14 * d);
        // Jittered position plus the legacy sinusoidal drift.
        vec2 pos = id + 0.2 + 0.6 * hash22(id * 1.7 + vec2(9.0 * fl, 0.0));
        pos += vec2(sin(t * 0.9 + h.y * 6.2831),
                    cos(t * 0.7 + h.x * 6.2831)) * 0.30;
        vec2 dd = gp - pos;
        float q = dot(dd, dd);
        float tw = 0.55 + 0.45 * sin(t * 2.5 + h.y * 6.2831); // twinkle pulse
        vec3 tint = uPalette[int(h.y * 3.999)];
        col += tint * exp(-q * 16.0) * tw * present * 0.55;
      }
    }
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#ff4080", "#8040ff", "#40e0ff", "#ff8000"],
};
