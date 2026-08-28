import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBackdropRenderer,
  resetWebGL2ProbeForTests,
  type BackdropController,
} from "../createThemeRenderer";
import type { RendererInputs } from "../types";

/* ------------------------------------------------------------------ */
/*  Canvas context mocks (jsdom has no canvas backend)                 */
/* ------------------------------------------------------------------ */

function createMock2dContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    createImageData: vi.fn((w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, Math.round(w)) * Math.max(1, Math.round(h)) * 4),
      width: w,
      height: h,
    })),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    globalAlpha: 1,
    font: "",
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

function createMockWebGL2Context(): WebGL2RenderingContext {
  const gl = {
    // Constants (values don't matter, only identity within the mock).
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    TRIANGLES: 5,
    VENDOR: 6,
    RENDERER: 7,
    // Pipeline
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
    viewport: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3fv: vi.fn(),
    drawArrays: vi.fn(),
    getParameter: vi.fn(() => "mock"),
    getExtension: vi.fn(() => null),
  } as unknown as WebGL2RenderingContext;
  return gl;
}

type GLBehavior = "ok" | "null" | "shader-fail";

let glBehavior: GLBehavior = "ok";
let mock2d: CanvasRenderingContext2D;
let mockGl: WebGL2RenderingContext;
let _getContextSpy: ReturnType<typeof vi.spyOn>;
let rafIds: number[];
let rafSpy: ReturnType<typeof vi.spyOn>;
let cancelSpy: ReturnType<typeof vi.spyOn>;

const canvases: HTMLCanvasElement[] = [];

beforeEach(() => {
  resetWebGL2ProbeForTests();
  glBehavior = "ok";
  mock2d = createMock2dContext();
  mockGl = createMockWebGL2Context();
  rafIds = [];
  canvases.splice(0);
  rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(((_cb: FrameRequestCallback) => {
    rafIds.push(rafIds.length + 1);
    return rafIds.length;
  }) as never);
  cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((() => {}) as never);
  _getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    canvases.push(this);
    if (type === "2d") return mock2d as never;
    if (type === "webgl2") {
      if (glBehavior === "null") return null as never;
      if (glBehavior === "shader-fail") {
        // Fail the second compile check (the effect fragment shader); the
        // vertex shader compiles first and stays healthy.
        let checks = 0;
        (mockGl.getShaderParameter as ReturnType<typeof vi.fn>).mockImplementation(
          () => ++checks === 1,
        );
      }
      return mockGl as never;
    }
    return null as never;
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeInputs(effectId: string, overrides: Partial<RendererInputs["environment"]> = {}): RendererInputs {
  return {
    effectId,
    paletteId: effectId === "jellyfish" ? "deep-ocean-glow" : undefined,
    density: 1,
    brightness: 1.2,
    environment: {
      mobile: false,
      onBattery: false,
      reducedMotion: false,
      animationsEnabled: true,
      visible: true,
      ...overrides,
    },
  };
}

function makeHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

describe("createBackdropRenderer backend selection", () => {
  it("uses WebGL2 for GPU-preferred effects when available", () => {
    const host = makeHost();
    const controller = createBackdropRenderer({ host, inputs: makeInputs("plasma") });
    controller.start();
    expect(controller.backend).toBe("webgl2");
    expect(host.querySelector("canvas.theme-backdrop-canvas")).not.toBeNull();
    expect(controller.diagnostics.snapshot.backend).toBe("webgl2");
    controller.dispose();
    expect(host.querySelector("canvas.theme-backdrop-canvas")).toBeNull();
  });

  it("falls back to Canvas2D when webgl2 is unavailable", () => {
    glBehavior = "null";
    const host = makeHost();
    const fallbacks: string[] = [];
    const controller = createBackdropRenderer({
      host,
      inputs: makeInputs("plasma"),
      onBackendFallback: (r) => fallbacks.push(r),
    });
    controller.start();
    expect(controller.backend).toBe("canvas2d");
    expect(fallbacks).toContain("webgl2-unavailable");
    controller.dispose();
  });

  it("falls back to Canvas2D when the shader fails to compile", () => {
    glBehavior = "shader-fail";
    const host = makeHost();
    const fallbacks: string[] = [];
    const controller = createBackdropRenderer({
      host,
      inputs: makeInputs("plasma"),
      onBackendFallback: (r) => fallbacks.push(r),
    });
    // Shader failure is detected during construction of the GL renderer.
    expect(controller.backend).toBe("canvas2d");
    expect(fallbacks).toContain("shader-init");
    controller.dispose();
  });

  it("keeps canvas-only effects on Canvas2D even with WebGL2", () => {
    const host = makeHost();
    const controller = createBackdropRenderer({ host, inputs: makeInputs("rain") });
    controller.start();
    expect(controller.backend).toBe("canvas2d");
    controller.dispose();
  });

  it("resolves unknown effects to no renderer (CSS-only themes)", () => {
    const host = makeHost();
    const controller = createBackdropRenderer({ host, inputs: makeInputs("liquid-glow") });
    controller.start();
    expect(controller.backend).toBe("none");
    expect(host.querySelector("canvas")).toBeNull();
    controller.dispose();
  });

  it("matches legacy prefix ids", () => {
    const host = makeHost();
    glBehavior = "null";
    const controller = createBackdropRenderer({ host, inputs: makeInputs("jelly") });
    controller.start();
    expect(controller.backend).toBe("canvas2d");
    controller.dispose();
  });
});

describe("static mode", () => {
  it("never schedules RAF for a static-capable effect", () => {
    const host = makeHost();
    glBehavior = "null";
    const controller = createBackdropRenderer({
      host,
      inputs: makeInputs("jellyfish", { animationsEnabled: false }),
    });
    controller.start();
    expect(controller.backend).toBe("canvas2d");
    expect(rafSpy).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("renders a static frame via WebGL2 when available", () => {
    const host = makeHost();
    const controller = createBackdropRenderer({
      host,
      inputs: makeInputs("plasma", { reducedMotion: true }),
    });
    controller.start();
    expect(controller.backend).toBe("webgl2");
    expect(rafSpy).not.toHaveBeenCalled();
    // One intentional frame at the fixed static time.
    expect(mockGl.drawArrays).toHaveBeenCalled();
    controller.dispose();
  });

  it("renders nothing for static-incapable Canvas2D effects", () => {
    const host = makeHost();
    glBehavior = "null";
    const controller = createBackdropRenderer({
      host,
      inputs: makeInputs("rain", { animationsEnabled: false }),
    });
    controller.start();
    expect(controller.backend).toBe("none");
    expect(host.querySelector("canvas")).toBeNull();
    controller.dispose();
  });
});

describe("fatal context loss", () => {
  it("swaps to Canvas2D after repeated losses", () => {
    const host = makeHost();
    const fallbacks: string[] = [];
    const controller = createBackdropRenderer({
      host,
      inputs: makeInputs("plasma"),
      onBackendFallback: (r) => fallbacks.push(r),
    });
    controller.start();
    expect(controller.backend).toBe("webgl2");
    const glCanvas = host.querySelector("canvas") as HTMLCanvasElement;

    for (let i = 0; i < 3; i++) {
      glCanvas.dispatchEvent(new Event("webglcontextlost"));
    }

    expect(controller.backend).toBe("canvas2d");
    expect(fallbacks).toContain("repeated-context-loss");
    // The GL canvas was removed and replaced by the Canvas2D canvas.
    expect(host.contains(glCanvas)).toBe(false);
    expect(host.querySelector("canvas.theme-backdrop-canvas")).not.toBeNull();
    controller.dispose();
  });
});

describe("controller lifecycle", () => {
  it("updateInputs forwards brightness without recreating the canvas", () => {
    const host = makeHost();
    const controller = createBackdropRenderer({ host, inputs: makeInputs("plasma") });
    controller.start();
    const canvas = host.querySelector("canvas") as HTMLCanvasElement;
    controller.updateInputs({ ...makeInputs("plasma"), brightness: 2.5 });
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(canvas.style.filter).toContain("2.5");
    controller.dispose();
  });

  it("dispose is idempotent and cancels pending RAF", () => {
    const host = makeHost();
    glBehavior = "null";
    const controller: BackdropController = createBackdropRenderer({ host, inputs: makeInputs("rain") });
    controller.start();
    const scheduled = rafIds.length;
    expect(scheduled).toBeGreaterThan(0);
    controller.dispose();
    controller.dispose();
    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe("review regression fixes", () => {
  it("M1: static mode + shader failure renders nothing instead of a Canvas2D RAF loop", () => {
    glBehavior = "shader-fail";
    const host = makeHost();
    const controller = createBackdropRenderer({
      host,
      inputs: makeInputs("plasma", { reducedMotion: true }),
    });
    controller.start();
    expect(controller.backend).toBe("none");
    expect(host.querySelector("canvas")).toBeNull();
    // No legacy Canvas2D loop may start under reduced motion.
    expect(rafSpy).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("B2: suspend keeps the painted canvas; resume restarts scheduling", () => {
    glBehavior = "null";
    const host = makeHost();
    const controller = createBackdropRenderer({ host, inputs: makeInputs("rain") });
    controller.start();
    const canvas = host.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    controller.suspend();
    // Frozen frame stays mounted; no canvas swap.
    expect(host.querySelector("canvas")).toBe(canvas);

    controller.resume();
    expect(host.querySelector("canvas")).toBe(canvas);
    // A legacy effect re-invoked → a new rAF id was registered.
    expect(rafIds.length).toBeGreaterThan(0);
    controller.dispose();
    expect(host.querySelector("canvas")).toBeNull();
  });
});
