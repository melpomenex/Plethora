/**
 * Effect: lavalamp
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: 6 metaball blobs on stateless lissajous paths — 6 length/exp taps
 * per pixel, cheap fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const lavalampEffect: WebGLEffect = {
  id: "lavalamp",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime * 0.5;

  vec3 col = uPalette[3] * 0.14; // warm dark glass

  float field = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    // Slow lissajous crawl — the lava-lamp drift, fully stateless.
    vec2 c = vec2(sin(t * 0.21 + fi * 2.4) * uAspect * 0.30,
                  sin(t * 0.17 + fi * 1.7) * 0.34);
    float r = 0.16 + 0.10 * hash11(fi * 3.7 + 1.0);
    r *= 1.0 + 0.10 * sin(t * 0.9 + fi * 2.0); // legacy radius breathing
    r *= 0.9 + 0.08 * d;
    float dist = length(p - c);
    float g = exp(-max(dist / max(r, 1e-4), 0.0) * 2.4); // legacy soft falloff
    field += g;
    vec3 tint = uPalette[i - (i / 3) * 3]; // cycle the three wax hues
    col += tint * g * 0.22;
  }
  // Metaball kiss: overlapping glows brighten and warm up.
  col *= 0.85 + 0.35 * smoothstep(0.8, 1.9, field);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#e63b1a", "#e68019", "#e6c319", "#8a240f"],
};
