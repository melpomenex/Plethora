/**
 * Shared GLSL ES 3.00 helpers concatenated into effect fragment shaders.
 * Keep this small and readable — it is a helper library, not a framework.
 */

/** Standard uniform block every ambient fragment shader declares. */
export const GLSL_STANDARD_UNIFORMS = `uniform float uTime;       // seconds
uniform vec2  uResolution; // backing-store pixels
uniform float uDensity;    // sanitized density multiplier (>= 0.25)
uniform float uAspect;     // width / height
uniform vec3  uPalette[6]; // effect colors (up to 6; unused slots are black)
`;

/** Hash / noise / rotation / palette helpers. Hash from IQ's articles. */
export const GLSL_COMMON = `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Value noise with quintic smoothing — smooth enough for ambient fields and
// far cheaper than simplex for fullscreen background work.
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += amp * valueNoise(p);
    p = rot * p * 2.03;
    amp *= 0.5;
  }
  return v;
}

vec2 rotate2d(vec2 v, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c) * v;
}

// Palette mix with smooth easing; t outside 0–1 clamps.
vec3 paletteMix(vec3 a, vec3 b, float t) {
  return mix(a, b, clamp(t, 0.0, 1.0));
}

// Soft radial glow, 1 at center, ~0 at radius.
float glow(vec2 center, vec2 uv, float radius) {
  float d = length(uv - center);
  return exp(-max(d / max(radius, 1e-4), 0.0) * 3.0);
}
`;

/** Standard fragment shader prelude: version + precision + uniforms + helpers. */
export const GLSL_PRELUDE = `#version 300 es
precision highp float;

${GLSL_STANDARD_UNIFORMS}
${GLSL_COMMON}
out vec4 fragColor;

// UV in 0–1 across the canvas (Y up), aspect-corrected space available via uAspect.
vec2 canvasUv() {
  return gl_FragCoord.xy / uResolution;
}
`;
