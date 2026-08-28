/**
 * Backdrop renderer controller: feature-detects, picks a backend, and swaps
 * to Canvas2D when the WebGL2 path fails fatally (repeated context loss,
 * failed restore, shader init error). A visual background must never block
 * the app — every failure degrades, never crashes.
 */
import type { RendererInputs, ThemeRenderer, ThemeRendererBackend } from "./types";
import { findEffect, prefersGpu } from "./effects";
import { createDiagnosticsSink, isDiagnosticsEnabled, type DiagnosticsSink } from "./diagnostics";
import { Canvas2DThemeRenderer } from "./canvas2d/Canvas2DThemeRenderer";
import { WebGLThemeRenderer, WebGLContextUnavailableError } from "./webgl2/WebGLThemeRenderer";
import { ShaderInitError } from "./webgl2/shaderUtils";

export type BackdropBackend = ThemeRendererBackend | "none";

export interface BackdropController {
  readonly backend: BackdropBackend;
  readonly diagnostics: DiagnosticsSink;
  start(): void;
  /** Stop all scheduling; keep the painted canvas (frozen frame). */
  suspend(): void;
  /** Restart activity after a suspend. */
  resume(): void;
  resize(width: number, height: number): void;
  updateInputs(inputs: RendererInputs): void;
  dispose(): void;
}

export interface CreateBackdropRendererOptions {
  host: HTMLElement;
  inputs: RendererInputs;
  /** Notified when the WebGL2 path degrades to Canvas2D (diagnostics/tests). */
  onBackendFallback?: (reason: string) => void;
}

/** Session-level WebGL2 probe result (one detached context, reused). */
let webgl2Support: boolean | null = null;

export function probeWebGL2(): boolean {
  if (webgl2Support !== null) return webgl2Support;
  try {
    if (typeof document === "undefined") {
      webgl2Support = false;
      return false;
    }
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false });
    webgl2Support = Boolean(gl);
    // Release the probe surface immediately; the real renderer creates its
    // own context on its own canvas.
    if (gl) {
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    }
    return webgl2Support;
  } catch {
    webgl2Support = false;
    return false;
  }
}

/** Test hook: reset the cached WebGL2 probe between test cases. */
export function resetWebGL2ProbeForTests(): void {
  webgl2Support = null;
}

export function createBackdropRenderer(
  opts: CreateBackdropRendererOptions,
): BackdropController {
  const { host, inputs } = opts;
  const effect = findEffect(inputs.effectId);
  const diagnostics = createDiagnosticsSink(inputs.effectId);
  const staticMode = Boolean(inputs.environment.reducedMotion || !inputs.environment.animationsEnabled);

  diagnostics.snapshot.onBattery = inputs.environment.onBattery;
  diagnostics.snapshot.reducedMotion = inputs.environment.reducedMotion;
  diagnostics.snapshot.visible = inputs.environment.visible;
  diagnostics.snapshot.density = inputs.density;

  let current: ThemeRenderer | null = null;
  let disposed = false;
  let fellBackAlready = false;

  const makeCanvas2d = (): ThemeRenderer | null => {
    if (!effect?.canvas2d) return null;
    // Static rendering through Canvas2D is only defined for effects whose
    // AnimFn honors staticOnly (jellyfish family): any other legacy effect
    // would immediately start its own RAF loop under reduced motion.
    if (staticMode && !effect.canvas2dStatic) return null;
    return new Canvas2DThemeRenderer({
      host,
      effectId: effect.id,
      anim: effect.canvas2d,
      supportsStatic: effect.canvas2dStatic,
      inputs,
      diagnostics,
    });
  };

  const swapToCanvas2d = (reason: string): void => {
    if (disposed || fellBackAlready) return;
    current?.dispose();
    current = null;
    const fallback = makeCanvas2d();
    if (fallback) {
      current = fallback;
      fallback.start();
    } else {
      diagnostics.snapshot.backend = "none";
    }
    fellBackAlready = true;
    opts.onBackendFallback?.(reason);
    diagnostics.publish();
  };

  const gpuPreferred = Boolean(effect && prefersGpu(effect));
  const webgl2Available = probeWebGL2();
  if (gpuPreferred && !webgl2Available) {
    // Observability: the probe short-circuits the GL constructor, so surface
    // the degradation reason here rather than silently starting Canvas2D.
    opts.onBackendFallback?.("webgl2-unavailable");
  }
  const wantsGpu = gpuPreferred && webgl2Available;
  diagnostics.snapshot.webgl2Available = webgl2Available;

  if (wantsGpu && effect?.webgl) {
    try {
      current = new WebGLThemeRenderer({
        host,
        effect: effect.webgl,
        inputs,
        diagnostics,
        onFatal: swapToCanvas2d,
      });
    } catch (err) {
      if (err instanceof ShaderInitError) {
        opts.onBackendFallback?.("shader-init");
      } else if (err instanceof WebGLContextUnavailableError) {
        opts.onBackendFallback?.("webgl2-unavailable");
      } else {
        // Unknown constructor failures still degrade, but loudly in dev.
        console.warn("[ambient] unexpected WebGL2 renderer failure", err);
        opts.onBackendFallback?.("unknown-webgl2-error");
      }
      current = null;
    }
  }

  if (!current) {
    current = makeCanvas2d();
  }

  return {
    get backend(): BackdropBackend {
      return current ? current.backend : "none";
    },
    get diagnostics() {
      return diagnostics;
    },
    start() {
      if (disposed) return;
      current?.start();
      diagnostics.publish();
    },
    suspend() {
      if (disposed) return;
      diagnostics.snapshot.visible = false;
      current?.suspend();
    },
    resume() {
      if (disposed) return;
      diagnostics.snapshot.visible = true;
      current?.resume();
    },
    resize(width: number, height: number) {
      current?.resize(width, height);
    },
    updateInputs(next: RendererInputs) {
      diagnostics.snapshot.onBattery = next.environment.onBattery;
      diagnostics.snapshot.reducedMotion = next.environment.reducedMotion;
      diagnostics.snapshot.visible = next.environment.visible;
      diagnostics.snapshot.density = next.density;
      current?.updateInputs(next);
    },
    dispose() {
      disposed = true;
      current?.dispose();
      current = null;
      // Stop exposing the (now dead) diagnostics snapshot.
      if (typeof window !== "undefined" && isDiagnosticsEnabled()) {
        const holder = window as unknown as {
          __plethoraAmbientDiagnostics?: DiagnosticsSink["snapshot"];
        };
        if (holder.__plethoraAmbientDiagnostics === diagnostics.snapshot) {
          holder.__plethoraAmbientDiagnostics = undefined;
        }
      }
    },
  };
}
