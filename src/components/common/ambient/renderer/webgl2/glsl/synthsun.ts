/**
 * Effect: synthsun
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..4]
 * Perf: radial sun gradient + scanline slots + inverted-perspective grid —
 * a handful of trig/pow taps per pixel, no noise, cheap fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const synthsunEffect: WebGLEffect = {
  id: "synthsun",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime * 0.3; // legacy 0.01/frame ≈ 0.3/s
  float w = 0.9 + 0.1 * d;

  vec3 col = mix(uPalette[3], uPalette[4], uv.y) * 0.9 * w; // synth dusk base

  // Sun disc: pink core fading to an amber halo (legacy gradient stops).
  vec2 sc = vec2(0.0, -0.15);
  float R = 0.10;
  float k = length(p - sc) / max(R, 1e-4);
  float disc = 1.0 - smoothstep(0.0, 1.0, k);
  col += paletteMix(uPalette[0] * 0.55, uPalette[1] * 0.28, smoothstep(0.0, 0.6, k)) * disc;

  // Scanline slots drifting down through the disc.
  float dy = p.y - sc.y;
  if (abs(dy) < R) {
    float stepLen = 0.025;
    float s = (dy + R) / stepLen + t;
    float slot = (1.0 - smoothstep(0.0, 0.10, abs(fract(s) - 0.5)))
               * step(abs(p.x - sc.x), R);
    col = mix(col, uPalette[3], slot * 0.55);
  }

  // Perspective grid below the horizon: rows rush toward the viewer.
  float hz = sc.y;
  if (p.y < hz) {
    float depth = hz - p.y;
    float ft = pow(max(depth / 0.525, 0.0), 0.77); // inverse of pow(ft, 1.3)
    float rows = fract(ft * 12.5 - t);
    float row = (1.0 - smoothstep(0.0, 0.09, abs(rows - 0.5)))
              * min(0.6, ft * 1.5)
              * smoothstep(0.0, 0.02, ft);
    col += uPalette[2] * row;

    // Vertical rays fanning out from the horizon center.
    float frac = depth / 0.35;
    float rayX = p.x / max(frac, 1e-4) / (0.15 * max(uAspect, 1e-4));
    float ray = (1.0 - smoothstep(0.0, 0.10, abs(fract(rayX + 0.5) - 0.5)))
              * 0.45 * smoothstep(0.0, 0.05, frac);
    col += uPalette[2] * ray;
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#ff3c78", "#ff7832", "#ff3cb4", "#0e041a", "#150733"],
};
