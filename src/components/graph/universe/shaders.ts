/**
 * Knowledge Universe — GLSL shaders
 *
 * All node visuals (glow, soft edge, twinkle, selection ring, focus dim,
 * system expansion) are computed on the GPU from per-vertex attributes and a
 * handful of uniforms, so focus transitions and hover changes never touch
 * per-node JavaScript in the render loop.
 */

/**
 * Node points.
 *
 * Attributes:
 * - position   expanded position (orbit slot)
 * - aOrigin    collapsed position (parent star)
 * - aColor     rgb
 * - aSize      base size in world-ish units (0 = paged/hidden)
 * - aClass     NodeClass (1/2 = orbiting child)
 * - aSystem    owning system index, -1 = none/belt
 * - aState     0 normal / 1 hovered / 2 selected / 3 search match
 * - aSeed      deterministic per-node random for phases
 */
export const NODE_VERTEX = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aClass;
  attribute float aSystem;
  attribute float aState;
  attribute float aSeed;

  uniform float uTime;
  uniform float uExpansion;
  uniform float uFocusSystem;
  uniform float uPixelRatio;
  uniform float uSizeScale;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vState;
  varying float vTwinkle;

  void main() {
    bool isChild = aClass > 0.5 && aClass < 2.5;
    bool hasFocus = uFocusSystem >= 0.0;
    float inFocus = (hasFocus && abs(aSystem - uFocusSystem) < 0.5) ? 1.0 : 0.0;

    // Orbiting children expand out of their star only when their system has
    // focus. Belt children (system -1) always sit at their own position.
    float expand = 1.0;
    float vis = 1.0;
    if (isChild) {
      if (aSystem < -0.5) {
        vis = 0.4; // Oort belt: always visible, always faint
      } else {
        expand = inFocus * uExpansion;
        vis = expand;
      }
    }
    vec3 pos = mix(aOrigin, position, expand);

    // Everything outside the focused system dims toward the backdrop.
    float dim = (hasFocus && inFocus < 0.5) ? 0.16 : 1.0;

    float boost = 1.0;
    if (aState > 2.5) {
      boost = 1.15 + 0.3 * (0.5 + 0.5 * sin(uTime * 4.0 + aSeed * 6.2831));
    } else if (aState > 1.5) {
      boost = 1.4;
    } else if (aState > 0.5) {
      boost = 1.25;
    }

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float atten = 320.0 / max(1.0, -mv.z);
    float size = aSize * uSizeScale * boost * atten * uPixelRatio;
    gl_PointSize = min(size, 110.0 * uPixelRatio);
    gl_Position = projectionMatrix * mv;

    vColor = aColor;
    vAlpha = vis * dim;
    vState = aState;
    vTwinkle = 0.82 + 0.18 * sin(uTime * (0.5 + fract(aSeed * 13.7)) + aSeed * 40.0);
  }
`;

export const NODE_FRAGMENT = /* glsl */ `
  precision mediump float;

  uniform float uLight; // 1.0 = light theme ("paper cosmos"), 0.0 = deep space

  varying vec3 vColor;
  varying float vAlpha;
  varying float vState;
  varying float vTwinkle;

  void main() {
    if (vAlpha < 0.004) discard;
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = length(uv);
    if (d > 1.0) discard;

    float core = smoothstep(0.45, 0.14, d);
    float glow = pow(max(0.0, 1.0 - d), 1.9);

    vec3 col;
    float alpha;
    if (uLight > 0.5) {
      // Solid ink mark with a soft aura — additive glow washes out on white.
      col = vColor * (0.72 + 0.38 * core);
      alpha = core + glow * 0.30;
    } else {
      col = vColor * (core * 1.5 + glow * 1.1 * vTwinkle) + vec3(1.0) * core * 0.35;
      alpha = core + glow * 0.9 * vTwinkle;
    }

    // Selection ring
    if (vState > 1.5 && vState < 2.5) {
      float ring = smoothstep(0.06, 0.0, abs(d - 0.72));
      col = mix(col, vec3(1.0), ring * (uLight > 0.5 ? 0.0 : 0.9));
      if (uLight > 0.5) col = mix(col, vColor * 0.4, ring);
      alpha = max(alpha, ring * 0.95);
    }

    gl_FragColor = vec4(col, alpha * vAlpha);
  }
`;

/**
 * Edges (LineSegments).
 *
 * Attributes:
 * - position  expanded endpoint
 * - aOrigin   collapsed endpoint
 * - aSystem   owning system for child edges, -2 for universe-level edges
 * - aKind     0 = universe-level, 1 = child (doc→extract, extract→card)
 * - aAlpha    base alpha for this edge type
 */
export const EDGE_VERTEX = /* glsl */ `
  attribute vec3 aOrigin;
  attribute float aSystem;
  attribute float aKind;
  attribute float aAlpha;

  uniform float uExpansion;
  uniform float uFocusSystem;
  uniform vec3 uEdgeColor;
  uniform vec3 uAccent;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    bool hasFocus = uFocusSystem >= 0.0;
    float inFocus = (hasFocus && abs(aSystem - uFocusSystem) < 0.5) ? 1.0 : 0.0;

    float expand = mix(1.0, inFocus * uExpansion, aKind);
    vec3 pos = mix(aOrigin, position, expand);

    float alpha = aAlpha;
    if (aKind > 0.5) {
      alpha *= inFocus * uExpansion * 1.6; // child links appear with the orbit
    } else if (hasFocus) {
      alpha *= 0.12; // universe links recede while a system has focus
    }

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // Depth fade: lines further from the camera recede.
    alpha *= clamp(260.0 / max(1.0, -mv.z), 0.25, 1.0);

    vColor = mix(uEdgeColor, uAccent, inFocus * 0.85);
    vAlpha = alpha;
    gl_Position = projectionMatrix * mv;
  }
`;

export const EDGE_FRAGMENT = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.004) discard;
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

/**
 * Background starfield. Static positions; twinkle phase from aSeed. During a
 * warp jump uWarp stretches stars radially for a sense of motion.
 */
export const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;

  uniform float uTime;
  uniform float uWarp;
  uniform float uPixelRatio;

  varying float vSeed;
  varying float vWarp;

  void main() {
    vec3 pos = position * (1.0 + uWarp * 0.55 * fract(aSeed * 7.31));
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float size = aSize * (1.0 + uWarp * 2.5 * fract(aSeed * 3.7));
    gl_PointSize = size * uPixelRatio * clamp(700.0 / max(1.0, -mv.z), 0.4, 2.2);
    gl_Position = projectionMatrix * mv;
    vSeed = aSeed;
    vWarp = uWarp;
  }
`;

export const STAR_FRAGMENT = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform vec3 uStarColor;
  uniform float uLight;

  varying float vSeed;
  varying float vWarp;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = length(uv);
    if (d > 1.0) discard;
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.3 + fract(vSeed * 11.3) * 0.9) + vSeed * 80.0);
    float body = pow(max(0.0, 1.0 - d), 2.0);
    float alpha = body * mix(0.5, 1.0, twinkle) * (uLight > 0.5 ? 0.35 : 0.85);
    alpha *= 1.0 + vWarp * 0.8;
    gl_FragColor = vec4(uStarColor, alpha);
  }
`;
