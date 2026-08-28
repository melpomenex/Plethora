/**
 * Canvas2D backend — hosts the legacy AnimFn effects with the exact hosting
 * semantics ThemeBackdrop used: 30 fps gate, window resize, interval registry,
 * `.anim-flash` cleanup, static path for effects that support it.
 *
 * Legacy effects drive their own requestAnimationFrame loop through the
 * `frame`/`shouldRender` hooks; this class owns lifecycle (cancel the frame
 * handle, clear intervals, remove listeners) rather than the loop itself.
 */
import type { AnimFn, RendererInputs, ThemeRenderer } from "../types";
import type { DiagnosticsSink } from "../diagnostics";
import { resolveQuality } from "../qualityPolicy";

const CANVAS2D_FPS = 30;

export interface Canvas2DThemeRendererOptions {
  host: HTMLElement;
  effectId: string;
  anim: AnimFn;
  supportsStatic: boolean;
  inputs: RendererInputs;
  diagnostics: DiagnosticsSink;
}

const SUSPENDED = 0;
const RUNNING = 1;

export class Canvas2DThemeRenderer implements ThemeRenderer {
  readonly backend = "canvas2d" as const;

  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly timers: number[] = [];
  private registeredResizeFn: (() => void) | null = null;
  private animationResizeFn: (() => void) | null = null;
  private legacyRafId: number | null = null;
  private lastGateTime = 0;
  private readonly diagnostics: DiagnosticsSink;
  private inputs: RendererInputs;
  private readonly anim: AnimFn;
  private readonly supportsStatic: boolean;
  private disposed = false;
  /** RUNNING, SUSPENDED, or 2 = never started. */
  private runState: number = 2;

  constructor(opts: Canvas2DThemeRendererOptions) {
    this.host = opts.host;
    this.inputs = opts.inputs;
    this.anim = opts.anim;
    this.supportsStatic = opts.supportsStatic;
    this.diagnostics = opts.diagnostics;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "theme-backdrop-canvas";
    this.canvas.style.filter = `brightness(${sanitizeBrightness(opts.inputs.brightness)})`;
    this.host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.diagnostics.snapshot.backend = "canvas2d";
    this.diagnostics.snapshot.fpsTarget = this.staticMode() ? 0 : CANVAS2D_FPS;
  }

  start(): void {
    if (this.disposed || this.runState === RUNNING) return;
    this.runState = RUNNING;
    if (!this.ctx) return;

    this.resize();
    this.registeredResizeFn = () => this.resize();
    window.addEventListener("resize", this.registeredResizeFn);

    this.anim(this.animCtx());
    this.diagnostics.publish();
  }

  /**
   * Stop all activity but keep the painted canvas in the DOM — a hidden or
   * unfocused window shows the frozen last frame, matching the pre-refactor
   * ThemeBackdrop behavior. Legacy effects cannot be resumed in place (they
   * own their rAF loop), so `resume` re-invokes the effect fresh.
   */
  suspend(): void {
    if (this.disposed || this.runState !== RUNNING) return;
    this.runState = SUSPENDED;
    this.cancelActivity();
  }

  resume(): void {
    if (this.disposed || this.runState !== SUSPENDED && this.runState !== 2) return;
    this.start();
  }

  resize(_width?: number, _height?: number): void {
    if (this.disposed) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.animationResizeFn?.();
    this.diagnostics.snapshot.renderWidth = this.canvas.width;
    this.diagnostics.snapshot.renderHeight = this.canvas.height;
    this.diagnostics.snapshot.renderScale = 1;
    this.diagnostics.snapshot.devicePixelRatio = Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  }

  updateInputs(inputs: RendererInputs): void {
    this.inputs = inputs;
    this.canvas.style.filter = `brightness(${sanitizeBrightness(inputs.brightness)})`;
    this.diagnostics.snapshot.onBattery = inputs.environment.onBattery;
    this.diagnostics.snapshot.reducedMotion = inputs.environment.reducedMotion;
    this.diagnostics.snapshot.visible = inputs.environment.visible;
    this.diagnostics.snapshot.density = this.effectiveDensity();
    this.diagnostics.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelActivity();
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    document.querySelectorAll(".anim-flash").forEach((e) => e.remove());
    this.canvas.remove();
  }

  private cancelActivity(): void {
    if (this.legacyRafId !== null) {
      cancelAnimationFrame(this.legacyRafId);
      this.legacyRafId = null;
    }
    this.timers.forEach((t) => clearInterval(t));
    this.timers.length = 0;
    if (this.registeredResizeFn) {
      window.removeEventListener("resize", this.registeredResizeFn);
      this.registeredResizeFn = null;
    }
    this.animationResizeFn = null;
  }

  private staticMode(): boolean {
    return Boolean(this.inputs.environment.reducedMotion || !this.inputs.environment.animationsEnabled);
  }

  private animCtx() {
    return {
      cv: this.canvas,
      ctx: this.ctx as CanvasRenderingContext2D,
      density: this.effectiveDensity(),
      _frameInterval: 1000 / CANVAS2D_FPS,
      timer: (id: number) => {
        this.timers.push(id);
      },
      onResize: (fn: () => void) => {
        this.animationResizeFn = fn;
      },
      frame: (id: number) => {
        this.legacyRafId = id;
      },
      shouldRender: (timestamp: number): boolean => {
        const interval = 1000 / CANVAS2D_FPS;
        const elapsed = timestamp - this.lastGateTime;
        if (elapsed >= interval) {
          this.lastGateTime = timestamp - (elapsed % interval);
          return true;
        }
        this.diagnostics.snapshot.droppedByGate++;
        return false;
      },
      ambientPaletteId: this.inputs.paletteId,
      staticOnly: this.staticMode(),
    };
  }

  private effectiveDensity(): number {
    const user = Number.isFinite(this.inputs.density) ? this.inputs.density : 1;
    // Tier-scaled (desktop battery 0.5, mobile 0.75, mobile battery 0.4) —
    // resolves to the same 0.5 desktop-battery halving the old host applied.
    return Math.max(0, user * resolveQuality(this.inputs.environment, "canvas2d").densityScale);
  }
}

function sanitizeBrightness(brightness: number): number {
  if (!Number.isFinite(brightness) || brightness <= 0) return 1;
  return Math.min(10, brightness);
}

