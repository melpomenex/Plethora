import { describe, expect, it, vi } from "vitest";
import {
  AMBIENT_GL_CONTEXT_ATTRIBUTES,
  FULLSCREEN_VERTEX_SHADER,
  ShaderInitError,
  compileShader,
  createEffectProgram,
  disposeEffectProgram,
  hexToRgb01,
  paletteToFloat32,
} from "../shaderUtils";
import type { WebGLEffect } from "../../types";

function createMockWebGL2Context() {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
  } as unknown as WebGL2RenderingContext;
  return gl;
}

const testEffect: WebGLEffect = {
  id: "test",
  fragment: "#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(1.0, 0.0, 0.0, 1.0); }",
  palette: ["#ff0000", "#00ff00", "#0000ff", "#ffffff"],
};

describe("shaderUtils", () => {
  it("compiles and links a valid program with cached uniforms", () => {
    const gl = createMockWebGL2Context();
    const bundle = createEffectProgram(gl, testEffect);
    expect(gl.createShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalled();
    expect(bundle.uniforms.time).toEqual({});
    expect(bundle.uniforms.palette).toEqual({});
    expect(() => disposeEffectProgram(gl, bundle)).not.toThrow();
    expect(gl.deleteProgram).toHaveBeenCalledWith(bundle.program);
  });

  it("throws ShaderInitError on compile failure and cleans up", () => {
    const gl = createMockWebGL2Context();
    (gl.getShaderParameter as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (gl.getShaderInfoLog as ReturnType<typeof vi.fn>).mockReturnValue("boom");
    expect(() => compileShader(gl, 2, "bad", "test", "fragment")).toThrowError(ShaderInitError);
    expect(gl.deleteShader).toHaveBeenCalled();
    try {
      createEffectProgram(gl, testEffect);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ShaderInitError);
      expect((err as ShaderInitError).effectId).toBe("test");
      expect((err as ShaderInitError).infoLog).toBe("boom");
    }
  });

  it("throws ShaderInitError on link failure", () => {
    const gl = createMockWebGL2Context();
    (gl.getProgramParameter as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(() => createEffectProgram(gl, testEffect)).toThrowError(ShaderInitError);
  });

  it("disposal is best-effort on a dead context", () => {
    const gl = createMockWebGL2Context();
    (gl.deleteProgram as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("context lost");
    });
    expect(() => disposeEffectProgram(gl, null)).not.toThrow();
  });

  it("parses hex colors with fallbacks", () => {
    expect(hexToRgb01("#ff8040")).toEqual([1, 128 / 255, 64 / 255]);
    expect(hexToRgb01("ff8040")).toEqual([1, 128 / 255, 64 / 255]);
    expect(hexToRgb01("nonsense")).toEqual([0, 0, 0]);
    expect(hexToRgb01(undefined as unknown as string)).toEqual([0, 0, 0]);
  });

  it("builds an 18-float palette buffer padded with black", () => {
    const data = paletteToFloat32(["#ffffff", "#000000"]);
    expect(data).toHaveLength(18);
    expect(Array.from(data.slice(0, 3))).toEqual([1, 1, 1]);
    expect(Array.from(data.slice(15))).toEqual([0, 0, 0]);
  });

  it("uses power-safe context attributes", () => {
    expect(AMBIENT_GL_CONTEXT_ATTRIBUTES.alpha).toBe(false);
    expect(AMBIENT_GL_CONTEXT_ATTRIBUTES.antialias).toBe(false);
    // Kept so a suspended (hidden/unfocused) canvas retains its frozen frame.
    expect(AMBIENT_GL_CONTEXT_ATTRIBUTES.preserveDrawingBuffer).toBe(true);
    expect(AMBIENT_GL_CONTEXT_ATTRIBUTES.powerPreference).not.toBe("high-performance");
  });

  it("vertex shader uses gl_VertexID (bufferless)", () => {
    expect(FULLSCREEN_VERTEX_SHADER).toContain("gl_VertexID");
    expect(FULLSCREEN_VERTEX_SHADER).not.toContain("attribute");
    expect(FULLSCREEN_VERTEX_SHADER).not.toContain("in vec2 aPos");
  });
});
