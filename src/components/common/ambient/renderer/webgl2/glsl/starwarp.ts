/**
 * Effect: starwarp
 * Uniforms: uTime, uResolution, uDensity, uAspect, uPalette[0..3]
 * Perf: 2 hashed star layers in (angle, inverse-radius) space (3x3 cells
 * each, ~18 iterations with a few trig taps) — moderate fullscreen pass,
 * fully stateless z-flythrough.
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";

export const starwarpEffect: WebGLEffect = {
  id: "starwarp",
  fragment: `${GLSL_PRELUDE}
void main() {
  vec2 uv = canvasUv();
  float d = clamp(uDensity, 0.25, 3.0);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime;

  float r = max(length(p), 1e-4);
  float ang = atan(p.y, p.x);

  vec3 col = uPalette[1] * 0.6; // deep-space wash
  col += uPalette[0] * exp(-r * 3.0) * 0.10; // warp-core haze

  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float arcs = 20.0 + 16.0 * fl;
    float speed = 2.0 + 1.2 * fl; // inverse-radius units per second
    float dens = 2.2 - 0.5 * fl;
    // Star grid over (angle, inverse radius): stars fly outward as t grows.
    vec2 g = vec2((ang / 6.2831 + 0.5) * arcs, dens / r + t * speed);
    vec2 baseId = floor(g);
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        // Wrap the angular axis so the seam at -pi/pi stays seamless.
        float cx = mod(baseId.x + float(i) + arcs, arcs);
        vec2 id = vec2(cx, baseId.y + float(j));
        vec2 h = hash22(id + vec2(0.0, 57.0 * fl));
        float present = step(h.x, 0.45 + 0.1 * d);
        float ir = (id.y + 0.2 + 0.6 * h.y - t * speed) / dens;
        float alive = step(0.05, ir);
        float rs = 1.0 / max(ir, 0.05);
        float as = (id.x / arcs) * 6.2831 - 3.14159;
        vec2 dir = vec2(cos(as), sin(as));
        vec2 dd = p - dir * rs;
        float dr = dot(dd, dir);                    // radial offset
        float dperp = dot(dd, vec2(-dir.y, dir.x)); // tangential offset
        // Longer smears near the core, where apparent speed is highest.
        float streak = 1.0 + 1.2 / max(rs * 3.0, 0.3);
        float q = dr * streak * dr * streak + dperp * dperp;
        float sharp = clamp(20.0 / max(rs, 0.08), 30.0, 400.0);
        // Near stars (small rs) are bigger and brighter, as in the z-buffer.
        float bright = clamp(1.0 - rs * 0.85, 0.0, 1.0);
        col += mix(uPalette[3], uPalette[2], bright)
             * exp(-q * sharp) * bright * present * alive * (0.8 + 0.4 * fl);
      }
    }
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
  palette: ["#c8d2ff", "#000004", "#ffffff", "#6470a0"],
};
