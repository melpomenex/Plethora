/**
 * Effect: nebula
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: three cloud decks of 2 valueNoise taps each (6 noise total) — a
 * single-digit-octave fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const nebulaEffect: WebGLEffect = {
  id: "nebula",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime * 0.05; // clouds cross the screen over ~40 s

  vec3 col = mix(uPalette[2], uPalette[3], 0.5) * 0.05;

  // Three drifting cloud decks, each thresholded into soft patches that
  // pulse like the legacy radial-gradient clouds.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 1.6 + fi * 0.9;
    vec2 q = p * scale + vec2(t * (0.4 + fi * 0.25), -t * (0.3 + fi * 0.2));
    float n = valueNoise(q) * 0.65 + valueNoise(q * 2.7 + vec2(5.0, 1.0)) * 0.35;
    float m = smoothstep(0.56 - 0.03 * d, 0.78, n);
    float pulse = 0.65 + 0.35 * sin(t * 2.0 + fi * 2.1);
    col += uPalette[i] * m * 0.20 * pulse;
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#cc3333", "#33cc33", "#3366cc", "#cc33cc"],
};
