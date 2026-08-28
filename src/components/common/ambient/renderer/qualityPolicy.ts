/**
 * Adaptive quality policy — pure functions, no DOM access.
 *
 * Tiers balance smoothness against power/thermal budgets. Desktop-AC gets the
 * full WebGL2 budget (60 fps, full render scale); battery and mobile taper fps,
 * render scale and density. Canvas2D keeps today's 30 fps everywhere and only
 * varies density, matching long-shipped behavior.
 */
import type { FrameBudget, RendererEnvironment } from "./types";

export interface QualityTier extends FrameBudget {
  /** Cooldown (ms) between adaptive step-downs so degradation cannot oscillate. */
  stepCooldownMs: number;
}

const DESKTOP_AC_GL: QualityTier = { fps: 60, renderScale: 1.0, densityScale: 1.0, stepCooldownMs: 2000 };
const DESKTOP_BATTERY_GL: QualityTier = { fps: 30, renderScale: 0.75, densityScale: 0.75, stepCooldownMs: 2000 };
const MOBILE_AC_GL: QualityTier = { fps: 24, renderScale: 0.6, densityScale: 0.6, stepCooldownMs: 3000 };
const MOBILE_BATTERY_GL: QualityTier = { fps: 15, renderScale: 0.5, densityScale: 0.4, stepCooldownMs: 3000 };

const CANVAS2D_AC: QualityTier = { fps: 30, renderScale: 1.0, densityScale: 1.0, stepCooldownMs: 2000 };
const CANVAS2D_BATTERY: QualityTier = { fps: 30, renderScale: 1.0, densityScale: 0.5, stepCooldownMs: 2000 };
const CANVAS2D_MOBILE: QualityTier = { fps: 30, renderScale: 1.0, densityScale: 0.75, stepCooldownMs: 3000 };
const CANVAS2D_MOBILE_BATTERY: QualityTier = { fps: 30, renderScale: 1.0, densityScale: 0.4, stepCooldownMs: 3000 };

export const STATIC_TIER: QualityTier = { fps: 0, renderScale: 1.0, densityScale: 1.0, stepCooldownMs: 0 };

/** DPR caps applied before render scale — 3× phones must not allocate 3× buffers. */
export const DPR_CAP_DESKTOP = 2.0;
export const DPR_CAP_MOBILE = 2.0;

/** Hard backing-store caps: no axis beyond 4096 px, no more than ~5.3M pixels. */
export const MAX_BACKING_AXIS = 4096;
export const MAX_BACKING_PIXELS = 5_308_416; // 2560×1440 × 1.44

export function resolveQuality(
  env: RendererEnvironment,
  backend: "webgl2" | "canvas2d",
): QualityTier {
  if (!env.animationsEnabled || env.reducedMotion) return STATIC_TIER;
  if (backend === "webgl2") {
    if (env.mobile) return env.onBattery ? MOBILE_BATTERY_GL : MOBILE_AC_GL;
    return env.onBattery ? DESKTOP_BATTERY_GL : DESKTOP_AC_GL;
  }
  if (env.mobile) return env.onBattery ? CANVAS2D_MOBILE_BATTERY : CANVAS2D_MOBILE;
  return env.onBattery ? CANVAS2D_BATTERY : CANVAS2D_AC;
}

/* ------------------------------------------------------------------ */
/*  Adaptive step-down                                                 */
/* ------------------------------------------------------------------ */

const FPS_LADDER = [60, 30, 24, 20, 15];
const SCALE_LADDER = [1.0, 0.85, 0.7, 0.5];

/** Rolling-window size (frames) before an overshoot verdict is trusted. */
export const ADAPT_WINDOW = 60;
/** Median frame cost must exceed the frame budget by this factor to step down. */
export const ADAPT_OVERSHOOT = 1.5;

export interface AdaptiveState {
  /** Monotonic ms timestamps of the last step-downs (Date.now-based). */
  lastStepAt: number;
  stepIndex: number;
}

export const initialAdaptiveState = (): AdaptiveState => ({ lastStepAt: 0, stepIndex: 0 });

/**
 * One quality step DOWN from the CURRENT budget — never up. Tiers below the
 * desktop-AC budget (battery/mobile) must degrade from wherever they started,
 * so the ladder is applied relative to the current fps/renderScale: lower the
 * fps first, then the render scale, and return null only at the floor
 * (15 fps / 0.5 scale).
 */
export function stepDown(budget: FrameBudget): FrameBudget | null {
  const lowerFps = FPS_LADDER.filter((f) => f < budget.fps);
  if (lowerFps.length > 0) {
    return { ...budget, fps: Math.max(...lowerFps) };
  }
  const lowerScale = SCALE_LADDER.filter((s) => s < budget.renderScale - 1e-9);
  if (lowerScale.length > 0) {
    return { ...budget, renderScale: Math.max(...lowerScale) };
  }
  return null;
}

/**
 * Decide whether sustained frame-cost overshoot warrants a quality step-down.
 * `sortedFrameCostsMs` is the ascending measured per-frame cost for the last
 * ADAPT_WINDOW frames; `frameBudgetMs` is 1000 / fps.
 *
 * Returns the next budget (one step below the current one), or null when the
 * current budget already sits at the floor or the cooldown has not elapsed.
 */
export function nextAdaptiveStep(
  budget: FrameBudget,
  sortedFrameCostsMs: number[],
  frameBudgetMs: number,
  nowMs: number,
  state: AdaptiveState,
  cooldownMs: number,
): FrameBudget | null {
  if (sortedFrameCostsMs.length < ADAPT_WINDOW) return null;
  const next = stepDown(budget);
  if (!next) return null; // already at the floor
  const median = sortedFrameCostsMs[Math.floor(sortedFrameCostsMs.length / 2)];
  if (!(median > frameBudgetMs * ADAPT_OVERSHOOT)) return null;
  if (nowMs - state.lastStepAt < cooldownMs) return null;
  return next;
}

/** Compute the WebGL backing-store size for a CSS viewport. */
export function computeBackingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  renderScale: number,
): { width: number; height: number } {
  const safeW = Number.isFinite(cssWidth) ? cssWidth : 0;
  const safeH = Number.isFinite(cssHeight) ? cssHeight : 0;
  if (safeW <= 0 || safeH <= 0) return { width: 0, height: 0 };
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const dprCap = dpr > DPR_CAP_DESKTOP ? DPR_CAP_DESKTOP : dpr;
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? Math.min(1, renderScale) : 1;
  let width = Math.round(safeW * dprCap * scale);
  let height = Math.round(safeH * dprCap * scale);
  width = Math.min(width, MAX_BACKING_AXIS);
  height = Math.min(height, MAX_BACKING_AXIS);
  const pixels = width * height;
  if (pixels > MAX_BACKING_PIXELS) {
    const shrink = Math.sqrt(MAX_BACKING_PIXELS / pixels);
    width = Math.max(1, Math.floor(width * shrink));
    height = Math.max(1, Math.floor(height * shrink));
  }
  return { width, height };
}
