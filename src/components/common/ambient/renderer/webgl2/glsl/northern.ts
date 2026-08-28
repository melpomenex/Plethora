/**
 * Effect: northern
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..4]
 * Perf: five filled sine curtains (2 sin each) plus one shared 4-octave fbm
 * for ray striations — cheap fullscreen pass.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const northernEffect: WebGLEffect = {
  id: "northern",
  fragment: `${GLSL_PRELUDE}
// One auroral band: wavy top edge, soft fill downward, legacy hue pulse.
vec3 band(vec2 p, float t, float yBase, float amp, float phase, vec3 tint, float st) {
  float edge = yBase + sin(p.x * 2.4 + t + phase) * amp
                   + sin(p.x * 6.4 + t * 1.3) * amp * 0.5;
  float h = edge - p.y;
  float fill = smoothstep(0.0, 0.02, h) * exp(-max(h, 0.0) * 2.0);
  float pulse = 0.75 + 0.25 * sin(t * 0.8 + phase);
  return tint * fill * pulse * (0.55 + 0.9 * st);
}

void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = uv * vec2(uAspect, 1.0);
  float t = uTime * 0.25; // legacy 0.006/frame ≈ 0.18/s

  // Shared vertical ray striations — the curtain structure.
  float st = fbm(vec2(p.x * 5.0, t * 0.2));

  vec3 col = mix(uPalette[3], uPalette[1], 0.4) * 0.06; // arctic night
  float w = 0.30 + 0.05 * d;
  // Legacy bands: hues 140, 180, 280, 160, 220 at their y offsets/amps.
  col += band(p, t, 0.8800, 0.0625, 1.40, uPalette[0] * w, st);
  col += band(p, t, 0.8200, 0.0500, 1.80, uPalette[1] * w, st);
  col += band(p, t, 0.7500, 0.0438, 2.80, uPalette[2] * w, st);
  col += band(p, t, 0.9000, 0.0688, 1.60, uPalette[4] * w, st);
  col += band(p, t, 0.7800, 0.0375, 2.20, uPalette[3] * w, st);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#33cc66", "#33cccc", "#cc3399", "#6633cc", "#33cc99"],
};
