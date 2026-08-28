/**
 * WebGL2 jellyfish ambient effect — GPU sibling of the Canvas2D
 * `jellyfishRenderer.ts` (which remains the fallback backend).
 *
 * Recreates the same visual identity procedurally: layered ocean gradient
 * with bottom-heavy vignette, two sine-interference caustic bands near the
 * top, sparse twinkling marine snow, and one large centered jellyfish —
 * scalloped bell SDF with radial ribs and a glowing core, 12 tapered
 * tentacle strands, 5 oral arms — pulsing on the same ~5.8 s bell period
 * and ~24 s drift period as the Canvas2D implementation.
 *
 * Palette mapping (12 Canvas2D fields -> 6 uniforms):
 *   uPalette[0] = oceanTop       uPalette[1] = oceanBottom
 *   uPalette[2] = jellyPrimary   uPalette[3] = glowPrimary
 *   uPalette[4] = tentacle       uPalette[5] = particle
 * oceanMid / jellySecondary / jellyCore / glowSecondary / caustic / vignette
 * are approximated by mixing these six (see shader header).
 */
import type { WebGLEffect } from "../../types";
import { GLSL_PRELUDE } from "./common";
import { resolveJellyfishPalette } from "../../../../../../themes/jellyfishPalettes";

export const jellyfishEffect: WebGLEffect = {
  id: "jellyfish",
  fragment: `${GLSL_PRELUDE}
// ===== effect: jellyfish ====================================================
// Polished ambient underwater scene, GPU recreation of the Canvas2D hero.
//
// Uniforms used:
//   uPalette[0] oceanTop      uPalette[1] oceanBottom   (gradient stops)
//   uPalette[2] jellyPrimary  (bell body)               (bell body)
//   uPalette[3] glowPrimary   (aura + highlight core)
//   uPalette[4] tentacle      (tentacle strands + oral arms)
//   uPalette[5] particle      (marine snow + caustic tint)
//   uTime (seconds), uDensity (snow threshold / strand weight), uAspect.
//   Approximations: oceanMid = mix(0,1); jellyCore/glowSecondary mix [2]/[3];
//   caustic = [5] toward [0]; vignette = darkened [1].
//
// Perf: single cheap fullscreen pass — 2 sine caustic bands, 2 hashed snow
// grids, and a 12+5 short strand loop gated behind a radial bounding test;
// no fbm, no textures, no large per-pixel loops.
// ============================================================================

// Signed distance to the bell dome (ellipse approximation, y-up local space:
// apex at +ry, rim at -0.34*ry). The rim is scalloped by an angular sine so
// the bottom edge reads as a curtained jellyfish veil (6 scallops).
float bellSdf(vec2 q, float rx, float ry) {
  vec2 eb = vec2(q.x / max(rx, 1e-4), (q.y - 0.33 * ry) / max(0.67 * ry, 1e-4));
  float phi = atan(eb.x, -eb.y);
  float lower = smoothstep(0.05, 0.5, -eb.y);
  float edgeR = 1.0 + sin(phi * 6.0) * 0.09 * lower;
  return (length(eb) - edgeR) * min(rx, ry);
}

// One layer of hashed, twinkling marine snow on a slowly falling grid.
// dotR is the dot radius in cell units; threshold picks sparse cells.
float snowLayer(vec2 uv, vec2 cells, float speed, float t, float threshold, float dotR) {
  vec2 sp = uv + vec2(sin(t * 0.35) * 0.008, t * speed);
  vec2 g = sp * cells;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 h = hash22(id);
  float extra = hash21(id + 17.17);
  float d = length(f - (vec2(extra, h.y) - 0.5) * 0.66);
  float presence = step(h.x, threshold);
  float twinkle = 0.55 + 0.45 * sin(t * (0.7 + h.y * 1.6) + extra * 6.2831);
  float dot0 = exp(-(d * d) / max(dotR * dotR, 1e-8));
  return presence * clamp(twinkle, 0.0, 1.0) * dot0;
}

void main() {
  vec2 uv = canvasUv();
  // Aspect-corrected space; the bell rides slightly above screen center
  // (Canvas2D ny ~ 0.24-0.28 from the top => ~0.30 above this origin).
  vec2 p = (uv - vec2(0.5, 0.42)) * vec2(uAspect, 1.0);
  float density = clamp(uDensity, 0.25, 3.0);

  // -- ocean: 3-stop vertical gradient (mid stop approximated by mixing) --
  float grad = 1.0 - uv.y; // 0 at screen top, 1 at bottom
  vec3 oceanMid = mix(uPalette[0], uPalette[1], 0.5);
  vec3 color = mix(uPalette[0], oceanMid, smoothstep(0.0, 0.45, grad));
  color = mix(color, uPalette[1], smoothstep(0.45, 1.0, grad));

  // -- caustics: two sine-interference bands washing down from the top --
  float ct = uTime * 0.15;
  float cx = uv.x * uAspect;
  vec3 causticTint = mix(uPalette[5], uPalette[0], 0.45);
  float caustic = 0.0;
  for (int b = 0; b < 2; b++) {
    float fb = float(b);
    float bandY = 0.65 - fb * 0.12;
    float wob = sin(cx * 3.1 + ct + fb * 1.2) * 0.012 + sin(cx * 6.6 + ct * 1.3) * 0.006;
    float below = 1.0 - smoothstep(-0.05, 0.02, uv.y - (bandY + wob));
    float shimmer = 0.55 + 0.45 * sin(cx * 9.0 - ct * 0.8 + fb * 2.1);
    caustic += below * (0.030 + fb * 0.012) * shimmer;
  }
  color += causticTint * caustic;

  // -- marine snow: two parallax layers of hashed twinkling dots --
  float snow = snowLayer(uv, vec2(5.0, 3.0), 0.008, uTime, min(0.9, 0.42 * density), 0.045);
  snow += snowLayer(uv, vec2(8.0, 5.0), 0.014, uTime, min(0.9, 0.26 * density), 0.032);
  color += uPalette[5] * snow * 0.22;

  // -- jellyfish hero ---------------------------------------------------------
  float driftT = uTime * 0.2618; // 2*PI / 24 s drift period
  float pulseT = uTime * 1.0834; // 2*PI / 5.8 s bell pulse period
  float squeeze = sin(pulseT);
  float scale0 = 0.15 * min(uAspect, 1.0);
  float rx = scale0 * (1.04 - squeeze * 0.045);
  float ry = scale0 * (0.82 + squeeze * 0.10);
  vec2 center = vec2(
    (sin(driftT + 0.4) * 0.025 + sin(driftT * 1.8) * 0.005) * uAspect,
    0.30 + cos(driftT * 0.82 + 0.4) * 0.024 + sin(pulseT) * 0.015
  );
  vec2 q = p - center;
  if (length(q) < scale0 * 4.0) {
    vec3 coreCol = mix(uPalette[2], uPalette[3], 0.55); // ~jellyCore
    vec3 auraCol = mix(uPalette[3], coreCol, 0.5);      // ~glowSecondary

    // aura behind the body, breathing with the bell pulse
    float pulseGlow = 0.85 + 0.15 * squeeze;
    color += uPalette[3] * (0.26 * pulseGlow) * glow(vec2(0.0, 0.1 * ry), q, scale0 * 1.6);
    color += auraCol * 0.10 * glow(vec2(0.0, -0.2 * ry), q, scale0 * 3.2);

    // 12 tapered tentacle strands beneath the rim (sin-modulated curves)
    float attachY = -0.32 * ry;
    float strandWeight = 0.85 + 0.15 * min(density, 1.6);
    float tent = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float spread = (fi / 11.0 - 0.5) * rx * 1.55;
      float phase = uTime * 1.05 + fi * 0.62;
      float len = scale0 * (2.35 + mod(fi, 4.0) * 0.2);
      float st = (attachY - q.y) / max(len, 1e-4);
      float live = step(-0.02, st) * step(st, 1.0);
      float sway = sin(phase) * 0.16 * smoothstep(0.0, 0.45, st)
                 + sin(phase * 0.72 + 1.4) * 0.20 * smoothstep(0.12, 0.75, st);
      float dx = abs(q.x - (spread + sway * scale0));
      float w = (scale0 * 0.012 + 0.0018) * (1.0 - 0.55 * st);
      tent += live * (1.0 - st * st * 0.35) * (1.0 - smoothstep(0.0, w + 0.003, dx));
    }
    color += uPalette[4] * tent * 0.42 * strandWeight;

    // 5 thicker oral arms, each with a bright core line
    float armAttach = -0.26 * ry;
    float arm = 0.0;
    float armCore = 0.0;
    for (int j = 0; j < 5; j++) {
      float fj = float(j);
      float offset = (fj / 4.0 - 0.5) * rx * 0.88;
      float phase = uTime * 0.82 + fj * 0.92;
      float len = scale0 * (2.05 + mod(fj, 3.0) * 0.22);
      float at = (armAttach - q.y) / max(len, 1e-4);
      float live = step(-0.05, at) * step(at, 1.0);
      float sway = sin(phase) * 0.12 * smoothstep(0.0, 0.5, at)
                 - sin(phase * 1.18 + 0.65) * 0.29 * smoothstep(0.1, 0.8, at);
      float dx = abs(q.x - (offset + sway * scale0));
      float wArm = scale0 * 0.085 * (1.0 - 0.45 * at);
      arm += live * (1.0 - at * 0.25) * (1.0 - smoothstep(0.0, wArm + 0.006, dx));
      armCore += live * (1.0 - at * 0.4) * (1.0 - smoothstep(0.0, scale0 * 0.02 + 0.002, dx));
    }
    color += mix(uPalette[4], uPalette[2], 0.45) * arm * 0.30;
    color += coreCol * armCore * 0.40;

    // bell dome: scalloped SDF fill with an off-center radial highlight
    float dBell = bellSdf(q, rx, ry);
    float bellMask = 1.0 - smoothstep(-0.008, 0.008, dBell);
    vec2 hc = vec2(-0.2 * rx, 0.48 * ry);
    float gd = length((q - hc) / vec2(max(rx, 1e-4), max(ry, 1e-4)));
    vec3 bellCol = mix(coreCol, mix(uPalette[2], uPalette[0], 0.30), clamp(gd * 1.1, 0.0, 1.0));
    float bodyFade = 1.0 - 0.72 * smoothstep(0.45, 1.05, gd);
    color += bellCol * bellMask * bodyFade * 0.72;

    // 7 radial ribs fanning from the apex (center rib brighter)
    vec2 da = q - vec2(0.0, ry);
    float ang = atan(da.x, max(-da.y, 1e-4));
    float lower = smoothstep(0.05, 0.5, -(q.y - 0.33 * ry) / max(0.67 * ry, 1e-4));
    float rib = smoothstep(0.70, 0.95, cos(ang * 15.708));
    float midBoost = 1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.04, abs(ang)));
    color += coreCol * rib * bellMask * (1.0 - 0.7 * lower) * midBoost * 0.22;

    // luminous gut spot + bright rim underline (stronger at the scalloped rim)
    color += coreCol * glow(vec2(0.0, 0.28 * ry), q, rx * 0.5) * bellMask * 0.35;
    float stroke = 1.0 - smoothstep(0.0, 0.009, abs(dBell));
    color += coreCol * stroke * bellMask * (0.30 + 0.45 * lower);
  }

  // -- vignette: bottom-heavy fade (Canvas2D) plus a soft edge falloff --
  vec3 vigCol = uPalette[1] * 0.55;
  color = mix(color, vigCol, 0.55 * smoothstep(0.5, 1.0, grad));
  float edge = length((uv - vec2(0.5, 0.5)) * vec2(uAspect, 1.0));
  color *= 1.0 - 0.16 * smoothstep(0.55, 1.15, edge);

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`,
  // deep-ocean-glow defaults, slot order as documented above.
  palette: ["#020617", "#071339", "#4F8CFF", "#4F8CFF", "#76D6FF", "#6EA8FF"],
  resolvePalette: (paletteId) => {
    const p = resolveJellyfishPalette(paletteId);
    return [p.oceanTop, p.oceanBottom, p.jellyPrimary, p.glowPrimary, p.tentacle, p.particle];
  },
};
