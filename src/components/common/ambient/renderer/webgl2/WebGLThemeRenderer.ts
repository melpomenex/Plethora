/**
 * WebGL2 backend for animated theme backdrops.
 *
 * One bufferless fullscreen triangle, one program per effect, cached uniform
 * locations, render-scale backing store with hard caps, context-loss handling
 * with a bounded retry budget, and adaptive quality step-down driven by
 * measured frame costs. Any construction failure (missing context, shader
 * compile/link error) throws — the factory catches and falls back to Canvas2D,
 * so a broken GPU path can never blank the app.
 */
import type { RendererInputs, ThemeRenderer, WebGLEffect } from "../types";
import { createFrameScheduler } from "../frameScheduler";
import type { DiagnosticsSink } from "../diagnostics";
import {
  ADAPT_WINDOW,
  computeBackingSize,
  initialAdaptiveState,
  nextAdaptiveStep,
  resolveQuality,
  type AdaptiveState,
  type QualityTier,
} from "../qualityPolicy";
import {
  AMBIENT_GL_CONTEXT_ATTRIBUTES,
  createEffectProgram,
  disposeEffectProgram,
  paletteToFloat32,
  type GLProgramBundle,
} from "./shaderUtils";

/** Fixed animation time (ms) for static frames — matches the jellyfish renderer. */
const STATIC_TIME_MS = 1200;
/** Context losses beyond this swap the backend to Canvas2D instead of retrying. */
const MAX_CONTEXT_LOSSES = 3;
/** A lost context that is not restored within this window is treated as fatal. */
const RESTORE_TIMEOUT_MS = 8000;
/** Frames between adaptive-quality evaluations. */
const ADAPT_EVAL_INTERVAL = 30;

export class WebGLContextUnavailableError extends Error {
  constructor() {
    super("webgl2 context unavailable");
    this.name = "WebGLContextUnavailableError";
  }
}

export interface WebGLThemeRendererOptions {
  host: HTMLElement;
  effect: WebGLEffect;
  inputs: RendererInputs;
  diagnostics: DiagnosticsSink;
  /** Called when the GL context is unrecoverable — controller swaps backends. */
  onFatal: (reason: string) => void;
}

export class WebGLThemeRenderer implements ThemeRenderer {
  readonly backend = "webgl2" as const;

  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private bundle: GLProgramBundle | null = null;
  private readonly scheduler;
  private readonly diagnostics: DiagnosticsSink;
  private readonly effect: WebGLEffect;
  private readonly onFatal: (reason: string) => void;
  private inputs: RendererInputs;
  private tier: QualityTier;
  private adaptive: AdaptiveState = initialAdaptiveState();
  private effectiveFps: number;
  private effectiveRenderScale: number;
  private paletteData: Float32Array;
  private contextLosses = 0;
  private contextAlive = true;
  private disposed = false;
  private started = false;
  private frameCounter = 0;
  private readonly resizeListener: () => void = () => {};
  /** Watchdog for a lost context that never restores (iOS memory pressure). */
  private restoreWatchdog: ReturnType<typeof setTimeout> | null = null;
  private staticModeMode: boolean;

  constructor(opts: WebGLThemeRendererOptions) {
    this.host = opts.host;
    this.effect = opts.effect;
    this.inputs = opts.inputs;
    this.diagnostics = opts.diagnostics;
    this.onFatal = opts.onFatal;
    this.staticModeMode = !opts.inputs.environment.animationsEnabled || opts.inputs.environment.reducedMotion;
    this.tier = resolveQuality(opts.inputs.environment, "webgl2");
    this.effectiveFps = this.tier.fps;
    this.effectiveRenderScale = this.tier.renderScale;
    this.paletteData = paletteToFloat32(this.resolvePalette());

    this.canvas = document.createElement("canvas");
    this.canvas.className = "theme-backdrop-canvas";
    this.canvas.style.filter = `brightness(${this.sanitizeBrightness(opts.inputs.brightness)})`;
    this.host.appendChild(this.canvas);

    const gl = this.canvas.getContext("webgl2", AMBIENT_GL_CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null;
    if (!gl) {
      this.dispose();
      throw new WebGLContextUnavailableError();
    }
    this.gl = gl;
    try {
      this.initGlResources();
    } catch (err) {
      // A failed program build must not leave a stray canvas in the host.
      this.dispose();
      throw err;
    }

    this.scheduler = createFrameScheduler({
      draw: (timestamp) => this.draw(timestamp),
      onFrameCost: (cost) => this.onFrameCost(cost),
    });

    const snapshot = this.diagnostics.snapshot;
    snapshot.backend = "webgl2";
    snapshot.webgl2Available = true;
    snapshot.glVendor = this.safeGlString(gl.getParameter(gl.VENDOR));
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    // Local diagnostics only — never logged to console or telemetry.
    snapshot.glRenderer = dbg
      ? this.safeGlString(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : this.safeGlString(gl.getParameter(gl.RENDERER));

    this.canvas.addEventListener("webglcontextlost", this.handleContextLost as EventListener);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored as EventListener);
    this.resizeListener = () => this.applySize();
    window.addEventListener("resize", this.resizeListener);
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.applySize();
    if (this.staticMode()) {
      // One intentional frame at a fixed time; no RAF ever scheduled.
      this.draw(STATIC_TIME_MS);
      this.diagnostics.snapshot.fpsTarget = 0;
      this.diagnostics.publish();
      return;
    }
    this.scheduler.start(this.effectiveFps);
    this.diagnostics.snapshot.fpsTarget = this.effectiveFps;
    this.diagnostics.publish();
  }

  /**
   * Stop scheduling but keep the painted canvas — with
   * `preserveDrawingBuffer: true` the last presented frame remains visible in
   * a hidden/unfocused window, matching the Canvas2D frozen-frame behavior.
   */
  suspend(): void {
    if (this.disposed) return;
    this.scheduler.stop();
  }

  resume(): void {
    if (this.disposed || !this.contextAlive) return;
    if (!this.started) {
      this.start();
      return;
    }
    if (this.staticMode()) {
      this.draw(STATIC_TIME_MS);
      return;
    }
    this.scheduler.start(this.effectiveFps);
  }

  resize(_width?: number, _height?: number): void {
    this.applySize();
  }

  updateInputs(inputs: RendererInputs): void {
    this.inputs = inputs;
    this.canvas.style.filter = `brightness(${this.sanitizeBrightness(inputs.brightness)})`;
    this.paletteData = paletteToFloat32(this.resolvePalette());
    const tier = resolveQuality(inputs.environment, "webgl2");
    const wasStatic = this.staticModeMode;
    const fpsChanged = tier.fps !== this.tier.fps;
    const scaleChanged = tier.renderScale !== this.tier.renderScale;
    this.tier = tier;
    this.staticModeMode = !inputs.environment.animationsEnabled || inputs.environment.reducedMotion;
    if (scaleChanged) {
      this.effectiveRenderScale = tier.renderScale;
      this.applySize();
    }
    if (fpsChanged) {
      this.effectiveFps = tier.fps;
      if (this.staticModeMode) {
        this.scheduler.stop();
      } else {
        this.scheduler.setFps(tier.fps);
        this.diagnostics.snapshot.fpsTarget = tier.fps;
      }
    }
    // Static↔animated transitions: the scheduler must never sit stopped on an
    // animated request, nor keep looping on a static one.
    if (wasStatic !== this.staticModeMode && this.started && !this.disposed && this.contextAlive) {
      if (this.staticModeMode) {
        this.scheduler.stop();
        this.draw(STATIC_TIME_MS);
        this.diagnostics.snapshot.fpsTarget = 0;
      } else {
        this.applySize();
        this.scheduler.start(this.effectiveFps);
        this.diagnostics.snapshot.fpsTarget = this.effectiveFps;
      }
    }
    this.refreshSnapshotEnvironment();
    this.diagnostics.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler?.stop();
    if (this.restoreWatchdog !== null) {
      clearTimeout(this.restoreWatchdog);
      this.restoreWatchdog = null;
    }
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost as EventListener);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored as EventListener);
    window.removeEventListener("resize", this.resizeListener);
    if (this.gl) {
      disposeEffectProgram(this.gl, this.bundle);
      // Free the GPU surface immediately rather than waiting for GC — the
      // canvas element is about to leave the DOM.
      try {
        this.gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        // best-effort
      }
      this.gl = null;
    }
    this.bundle = null;
    this.canvas.remove();
  }

  // -- internals ------------------------------------------------------------

  private get effectId(): string {
    return this.effect.id;
  }

  private staticMode(): boolean {
    return this.staticModeMode;
  }

  private resolvePalette(): string[] {
    if (this.effect.resolvePalette) {
      const palette = this.effect.resolvePalette(this.inputs.paletteId);
      if (Array.isArray(palette) && palette.length >= 4 && palette.length <= 6) return palette;
    }
    return this.effect.palette;
  }

  private initGlResources(): void {
    const gl = this.gl;
    if (!gl) return;
    disposeEffectProgram(gl, this.bundle);
    this.bundle = createEffectProgram(gl, this.effect);
    gl.useProgram(this.bundle.program);
  }

  private applySize(): void {
    const gl = this.gl;
    if (!gl || this.disposed) return;
    const cssWidth = this.host.clientWidth || window.innerWidth;
    const cssHeight = this.host.clientHeight || window.innerHeight;
    const { width, height } = computeBackingSize(
      cssWidth,
      cssHeight,
      window.devicePixelRatio,
      this.effectiveRenderScale,
    );
    if (width <= 0 || height <= 0) return;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.diagnostics.snapshot.renderWidth = width;
    this.diagnostics.snapshot.renderHeight = height;
    this.diagnostics.snapshot.renderScale = this.effectiveRenderScale;
    this.diagnostics.snapshot.devicePixelRatio = Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  }

  private draw(timestampMs: number): void {
    const gl = this.gl;
    const bundle = this.bundle;
    if (!gl || !bundle || !this.contextAlive || this.disposed) return;
    if (this.canvas.width <= 0 || this.canvas.height <= 0) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(bundle.program);
    const t = Number.isFinite(timestampMs) ? timestampMs / 1000 : 0;
    gl.uniform1f(bundle.uniforms.time, t);
    gl.uniform2f(bundle.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(bundle.uniforms.density, this.sanitizeDensity());
    gl.uniform1f(bundle.uniforms.aspect, this.canvas.width / Math.max(1, this.canvas.height));
    gl.uniform3fv(bundle.uniforms.palette, this.paletteData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private onFrameCost(costMs: number): void {
    this.diagnostics.recordFrame(costMs, performance.now());
    this.frameCounter++;
    if (this.frameCounter % 15 === 0) this.diagnostics.publish();
    if (this.frameCounter % ADAPT_EVAL_INTERVAL !== 0) return;

    const costs = this.diagnostics.snapshot.frameCosts;
    if (costs.length < ADAPT_WINDOW) return;
    const frameBudgetMs = 1000 / Math.max(1, this.effectiveFps);
    const next = nextAdaptiveStep(
      { fps: this.effectiveFps, renderScale: this.effectiveRenderScale, densityScale: this.tier.densityScale },
      [...costs].sort((a, b) => a - b),
      frameBudgetMs,
      performance.now(),
      this.adaptive,
      this.tier.stepCooldownMs,
    );
    if (!next) return;
    this.adaptive = { lastStepAt: performance.now(), stepIndex: this.adaptive.stepIndex + 1 };
    this.effectiveFps = next.fps;
    this.effectiveRenderScale = next.renderScale;
    this.scheduler.setFps(next.fps);
    this.applySize();
    this.diagnostics.snapshot.fpsTarget = next.fps;
    this.diagnostics.snapshot.adaptiveStepIndex = this.adaptive.stepIndex;
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.contextAlive = false;
    this.contextLosses++;
    this.scheduler.stop();
    this.diagnostics.snapshot.contextLosses = this.contextLosses;
    this.diagnostics.publish();
    if (this.disposed) return;
    if (this.contextLosses >= MAX_CONTEXT_LOSSES) {
      this.onFatal("repeated-context-loss");
      return;
    }
    // Some engines never fire webglcontextrestored (e.g. iOS refuses the
    // restore under memory pressure). If nothing comes back in time, degrade
    // to Canvas2D instead of leaving a dead backdrop forever.
    this.restoreWatchdog = setTimeout(() => {
      this.restoreWatchdog = null;
      if (!this.disposed && !this.contextAlive) {
        this.onFatal("restore-timeout");
      }
    }, RESTORE_TIMEOUT_MS);
  };

  private readonly handleContextRestored = () => {
    if (this.disposed) return;
    if (this.restoreWatchdog !== null) {
      clearTimeout(this.restoreWatchdog);
      this.restoreWatchdog = null;
    }
    this.gl = this.canvas.getContext("webgl2", AMBIENT_GL_CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null;
    if (!this.gl) {
      this.onFatal("restore-failed");
      return;
    }
    try {
      this.contextAlive = true;
      // The old bundle belongs to the lost context; deleting foreign GL
      // objects only pollutes the new context's error state. Drop the
      // reference and rebuild from scratch.
      this.bundle = null;
      this.initGlResources();
      this.applySize();
      if (!this.staticMode()) {
        this.scheduler.start(this.effectiveFps);
      } else {
        this.draw(STATIC_TIME_MS);
      }
    } catch {
      this.onFatal("reinit-failed");
    }
  };

  private sanitizeDensity(): number {
    const user = Number.isFinite(this.inputs.density) ? this.inputs.density : 1;
    return Math.min(8, Math.max(0.25, user * this.tier.densityScale));
  }

  private sanitizeBrightness(brightness: number): number {
    if (!Number.isFinite(brightness) || brightness <= 0) return 1;
    return Math.min(10, brightness);
  }

  private safeGlString(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) return value.slice(0, 128);
    return null;
  }

  private refreshSnapshotEnvironment(): void {
    const env = this.inputs.environment;
    this.diagnostics.snapshot.onBattery = env.onBattery;
    this.diagnostics.snapshot.reducedMotion = env.reducedMotion;
    this.diagnostics.snapshot.visible = env.visible;
    this.diagnostics.snapshot.density = this.sanitizeDensity();
  }
}
