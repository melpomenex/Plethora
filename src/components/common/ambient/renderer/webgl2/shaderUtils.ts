/**
 * Minimal WebGL2 helpers: shader compile/link with typed errors, cached
 * uniform locations, and a bufferless fullscreen triangle (GLSL ES 3.00
 * gl_VertexID trick — no VBOs to create, leak, or restore).
 */
import type { WebGLEffect } from "../types";

export class ShaderInitError extends Error {
  readonly effectId: string;
  readonly infoLog: string;
  constructor(effectId: string, stage: string, infoLog: string) {
    super(`ambient shader init failed (${effectId} ${stage}): ${infoLog}`);
    this.name = "ShaderInitError";
    this.effectId = effectId;
    this.infoLog = infoLog;
  }
}

/** Fullscreen triangle, no attributes, no buffers. */
export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export interface StandardUniformLocations {
  time: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  density: WebGLUniformLocation | null;
  aspect: WebGLUniformLocation | null;
  palette: WebGLUniformLocation | null;
}

export interface GLProgramBundle {
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
  uniforms: StandardUniformLocations;
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  effectId: string,
  stage: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new ShaderInitError(effectId, stage, "createShader returned null");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown";
    gl.deleteShader(shader);
    throw new ShaderInitError(effectId, stage, log);
  }
  return shader;
}

export function createEffectProgram(
  gl: WebGL2RenderingContext,
  effect: WebGLEffect,
): GLProgramBundle {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER, effect.id, "vertex");
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, effect.fragment, effect.id, "fragment");
  const program = gl.createProgram();
  if (!program) throw new ShaderInitError(effect.id, "link", "createProgram returned null");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown";
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new ShaderInitError(effect.id, "link", log);
  }
  return {
    program,
    vertexShader,
    fragmentShader,
    uniforms: {
      time: gl.getUniformLocation(program, "uTime"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      density: gl.getUniformLocation(program, "uDensity"),
      aspect: gl.getUniformLocation(program, "uAspect"),
      palette: gl.getUniformLocation(program, "uPalette[0]"),
    },
  };
}

export function disposeEffectProgram(gl: WebGL2RenderingContext, bundle: GLProgramBundle | null): void {
  if (!bundle) return;
  try {
    gl.deleteProgram(bundle.program);
    gl.deleteShader(bundle.vertexShader);
    gl.deleteShader(bundle.fragmentShader);
  } catch {
    // Context may already be gone; disposal is best-effort.
  }
}

/** "#rrggbb" → [r,g,b] in 0–1; falls back to black for malformed input. */
export function hexToRgb01(hex: string): [number, number, number] {
  if (typeof hex !== "string") return [0, 0, 0];
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Standard palette size: uPalette[6]. Effects may use fewer entries. */
export const PALETTE_UNIFORM_COUNT = 6;

export function paletteToFloat32(palette: readonly string[]): Float32Array {
  const out = new Float32Array(PALETTE_UNIFORM_COUNT * 3);
  const count = Math.min(PALETTE_UNIFORM_COUNT, palette.length);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = hexToRgb01(palette[i] ?? "#000000");
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

/** WebGL context attributes for an ambient background surface. */
export const AMBIENT_GL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  // The canvas must keep its last presented frame while the renderer is
  // suspended (hidden/unfocused window shows the frozen frame, matching the
  // Canvas2D behavior). Without this the buffer may be discarded after
  // compositing and the paused backdrop would go black on some engines.
  preserveDrawingBuffer: true,
  // "default" avoids waking discrete GPUs on dual-GPU laptops.
  powerPreference: "default",
};
