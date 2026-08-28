/**
 * Effect: oceanwaves
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: four sine-filled curtains (2 sin each) plus 4 valueNoise shimmer taps
 * — cheap fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const oceanwavesEffect: WebGLEffect = {
  id: "oceanwaves",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = uv * vec2(uAspect, 1.0);
  float t = uTime * 0.6; // legacy 0.02/frame at ~30 fps

  // Deep-water gradient above the swell, brighter toward the horizon line.
  vec3 col = mix(uPalette[2] * 0.55, uPalette[2] * 0.18, uv.y);
  col += uPalette[3] * 0.10 * exp(-abs(uv.y - 0.62) * 6.0);

  // Four stacked wave curtains (legacy w = 0..3), Y up.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float yB = 0.35 - fi * 0.0375; // legacy 0.65h + w*30 px
    float edge = yB + sin(p.x * 4.0 + t + fi * 1.5) * 0.019
                      + sin(p.x * 8.0 + t * 0.7) * 0.010;
    float h = edge - p.y; // > 0 under the surface
    float fill = smoothstep(0.0, 0.02, h);
    vec3 water = mix(uPalette[2], uPalette[0], 0.35 + 0.2 * fi);
    float shimmer = 0.85 + 0.3 * valueNoise(vec2(p.x * 5.0, p.y * 3.0 + t * 0.2));
    col += water * fill * (0.16 + fi * 0.045) * shimmer * (0.8 + 0.1 * d);
    col += uPalette[3] * exp(-abs(h) * 55.0) * 0.18; // crest highlight
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#14508c", "#1e68a8", "#0c3054", "#5a9fd0"],
};
