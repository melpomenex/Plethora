/**
 * Core renderer abstraction for animated theme backdrops.
 *
 * React (ThemeBackdrop) owns lifecycle and environment state. Everything here is
 * framework-independent: backends implement `ThemeRenderer`, effects are plain
 * data/record entries, and quality/scheduling decisions are pure functions.
 */

export type ThemeRendererBackend = "webgl2" | "canvas2d" | "static";

/** Environment facts the quality policy and renderers react to. */
export interface RendererEnvironment {
  /** Native mobile (Android/iOS) — animations default off; quality is conservative. */
  mobile: boolean;
  /** Device reports it is running on battery. */
  onBattery: boolean;
  /** OS prefers-reduced-motion is active. */
  reducedMotion: boolean;
  /** User master animation toggle. */
  animationsEnabled: boolean;
  /** Document visible AND window focused AND not suspended. */
  visible: boolean;
}

/** Inputs the React layer pushes into the renderer whenever they change. */
export interface RendererInputs {
  effectId: string;
  /** Ambient palette id (jellyfish family); other effects use their defaults. */
  paletteId?: string;
  /** User particle-density multiplier (animationFrequency, 0.25–8). */
  density: number;
  /** Canvas CSS brightness gain (already clamped, e.g. 1.2). */
  brightness: number;
  environment: RendererEnvironment;
}

/** Frame pacing / quality budget selected by the quality policy. */
export interface FrameBudget {
  /** Target frames per second (0 = static, no RAF). */
  fps: number;
  /** Backing-store scale relative to clamped CSS×DPR size (WebGL2 only). */
  renderScale: number;
  /** Multiplier applied to the user density for this tier. */
  densityScale: number;
}

/**
 * A live backdrop renderer. Backends create and own their canvas element inside
 * the host container and MUST release everything (RAF handle, timers,
 * listeners, DOM nodes, GL resources) when disposed.
 */
export interface ThemeRenderer {
  readonly backend: ThemeRendererBackend;
  start(): void;
  /** Stop all scheduling but keep the painted canvas visible (frozen frame). */
  suspend(): void;
  /** Restart activity after a suspend (or first start when never started). */
  resume(): void;
  resize(width: number, height: number): void;
  updateInputs(inputs: RendererInputs): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/*  Legacy Canvas2D effect contract (moved verbatim from ThemeBackdrop) */
/* ------------------------------------------------------------------ */

export type AnimCtx = {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Particle-count multiplier (0.25–2). Animations should multiply their base count by this. */
  density: number;
  /** Minimum ms between frames (0 = uncapped). Default 33ms (~30fps) */
  _frameInterval: number;
  /** Register a timer that will be cleaned up on stop */
  timer: (id: number) => void;
  /** Register a resize listener (auto-cleaned) */
  onResize: (fn: () => void) => void;
  /** Call this with your rAF id each frame */
  frame: (id: number) => void;
  /** Returns true if enough time has elapsed to render a frame */
  shouldRender: (timestamp: number) => boolean;
  /** Shared ambient renderer palette (jellyfish family). */
  ambientPaletteId?: string;
  /** Draw one static frame without RAF (reduced motion / animations off). */
  staticOnly?: boolean;
};

export type AnimFn = (a: AnimCtx) => void;

/* ------------------------------------------------------------------ */
/*  WebGL2 effect contract                                             */
/* ------------------------------------------------------------------ */

/**
 * A GPU effect: a full fragment shader for the fullscreen triangle plus the
 * default palette it renders with when no theme palette applies.
 * Jellyfish supplies its palette from `resolveJellyfishPalette` instead.
 *
 * Standard uniforms every shader may rely on (declared in GLSL_PRELUDE):
 *   uniform float uTime;       // seconds
 *   uniform vec2  uResolution; // backing-store pixels
 *   uniform float uDensity;    // sanitized density multiplier
 *   uniform float uAspect;     // width / height
 *   uniform vec3  uPalette[6]; // effect colors (up to 6; unused slots are black)
 */
export interface WebGLEffect {
  id: string;
  /** GLSL ES 3.00 fragment shader source (`#version 300 es` included via GLSL_PRELUDE). */
  fragment: string;
  /** Default palette (hex, 4–6 entries) mirrored from the Canvas2D implementation. */
  palette: string[];
  /**
   * Theme-driven palette override (jellyfish family): given the ambient
   * palette id, return the uniform colors (same length rules as `palette`).
   */
  resolvePalette?: (paletteId: string | undefined) => string[];
}
