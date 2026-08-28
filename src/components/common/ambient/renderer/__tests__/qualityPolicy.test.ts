import { describe, expect, it } from "vitest";
import {
  ADAPT_OVERSHOOT,
  ADAPT_WINDOW,
  computeBackingSize,
  initialAdaptiveState,
  MAX_BACKING_AXIS,
  MAX_BACKING_PIXELS,
  nextAdaptiveStep,
  resolveQuality,
} from "../qualityPolicy";
import type { FrameBudget, RendererEnvironment } from "../types";

function env(overrides: Partial<RendererEnvironment> = {}): RendererEnvironment {
  return {
    mobile: false,
    onBattery: false,
    reducedMotion: false,
    animationsEnabled: true,
    visible: true,
    ...overrides,
  };
}

describe("resolveQuality tiers", () => {
  it("gives desktop-AC WebGL2 the full budget", () => {
    const tier = resolveQuality(env(), "webgl2");
    expect(tier.fps).toBe(60);
    expect(tier.renderScale).toBe(1.0);
    expect(tier.densityScale).toBe(1.0);
  });

  it("tapers desktop battery", () => {
    const tier = resolveQuality(env({ onBattery: true }), "webgl2");
    expect(tier.fps).toBe(30);
    expect(tier.renderScale).toBeLessThan(1.0);
    expect(tier.densityScale).toBeLessThan(1.0);
  });

  it("bounds mobile WebGL2 well below desktop", () => {
    const ac = resolveQuality(env({ mobile: true }), "webgl2");
    expect(ac.fps).toBeLessThanOrEqual(24);
    expect(ac.renderScale).toBeLessThanOrEqual(0.6);
    expect(ac.densityScale).toBeLessThanOrEqual(0.6);
    const battery = resolveQuality(env({ mobile: true, onBattery: true }), "webgl2");
    expect(battery.fps).toBeLessThan(ac.fps);
    expect(battery.renderScale).toBeLessThan(ac.renderScale);
  });

  it("keeps Canvas2D at 30 fps everywhere with battery density halving only", () => {
    expect(resolveQuality(env(), "canvas2d").fps).toBe(30);
    expect(resolveQuality(env({ onBattery: true }), "canvas2d").densityScale).toBe(0.5);
    expect(resolveQuality(env({ mobile: true }), "canvas2d").fps).toBe(30);
  });

  it("static tier has no fps", () => {
    expect(resolveQuality(env({ reducedMotion: true }), "webgl2").fps).toBe(0);
    expect(resolveQuality(env({ animationsEnabled: false }), "webgl2").fps).toBe(0);
  });
});

describe("nextAdaptiveStep", () => {
  it("does nothing before the window fills", () => {
    const state = initialAdaptiveState();
    const budget = { fps: 60, renderScale: 1.0, densityScale: 1.0 };
    const costs = new Array(ADAPT_WINDOW - 1).fill(50);
    expect(nextAdaptiveStep(budget, costs, 16.7, 10_000, state, 0)).toBeNull();
  });

  it("steps down on sustained overshoot", () => {
    const state = initialAdaptiveState();
    const budget = { fps: 60, renderScale: 1.0, densityScale: 1.0 };
    const costs = new Array(ADAPT_WINDOW).fill(16.7 * ADAPT_OVERSHOOT * 2);
    const next = nextAdaptiveStep(budget, costs, 16.7, 10_000, state, 0);
    expect(next).not.toBeNull();
    expect(next!.fps).toBe(30);
  });

  it("respects the cooldown", () => {
    const budget = { fps: 60, renderScale: 1.0, densityScale: 1.0 };
    const costs = new Array(ADAPT_WINDOW).fill(100);
    const state = { lastStepAt: 9_000, stepIndex: 0 };
    expect(nextAdaptiveStep(budget, costs, 16.7, 10_000, state, 2_000)).toBeNull();
  });

  it("stops at the floor", () => {
    let budget = { fps: 60, renderScale: 1.0, densityScale: 1.0 };
    let state = initialAdaptiveState();
    const costs = new Array(ADAPT_WINDOW).fill(1e6);
    for (let i = 0; i < 10; i++) {
      const next = nextAdaptiveStep(budget, costs, 16.7, 100_000 + i * 10_000, state, 0);
      if (!next) break;
      budget = next;
      state = { lastStepAt: 100_000 + i * 10_000, stepIndex: state.stepIndex + 1 };
    }
    expect(budget.fps).toBe(15);
    expect(budget.renderScale).toBe(0.5);
  });
});

describe("computeBackingSize", () => {
  it("applies dpr cap and render scale", () => {
    const { width, height } = computeBackingSize(1920, 1080, 3, 0.75);
    // dpr capped at 2, then 0.75 scale
    expect(width).toBe(Math.round(1920 * 2 * 0.75));
    expect(height).toBe(Math.round(1080 * 2 * 0.75));
  });

  it("keeps a 3x phone bounded", () => {
    const { width, height } = computeBackingSize(390, 844, 3, 0.6);
    expect(width * height).toBeLessThanOrEqual(MAX_BACKING_PIXELS);
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_BACKING_AXIS);
  });

  it("caps total pixels on huge desktops", () => {
    const { width, height } = computeBackingSize(7680, 4320, 2, 1.0);
    expect(width * height).toBeLessThanOrEqual(MAX_BACKING_PIXELS);
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_BACKING_AXIS);
  });

  it("returns zero for degenerate sizes and NaN inputs", () => {
    expect(computeBackingSize(0, 100, 1, 1)).toEqual({ width: 0, height: 0 });
    expect(computeBackingSize(NaN, 100, 1, 1)).toEqual({ width: 0, height: 0 });
    expect(computeBackingSize(100, Infinity, 1, 1)).toEqual({ width: 0, height: 0 });
  });
});

describe("adaptive steps never raise quality (B1 regression)", () => {
  const overshoot = new Array(ADAPT_WINDOW).fill(1e6);

  it("steps DOWN from the desktop-battery tier", () => {
    const start = resolveQuality(env({ onBattery: true }), "webgl2"); // 30 / 0.75
    const state = initialAdaptiveState();
    const next = nextAdaptiveStep(start, overshoot, 1000 / start.fps, 10_000, state, 0);
    expect(next).not.toBeNull();
    expect(next!.fps).toBeLessThanOrEqual(start.fps);
    expect(next!.renderScale).toBeLessThanOrEqual(start.renderScale);
  });

  it("steps DOWN from the mobile tiers and floors there", () => {
    for (const mobileEnv of [env({ mobile: true }), env({ mobile: true, onBattery: true })]) {
      let budget: FrameBudget = resolveQuality(mobileEnv, "webgl2");
      const startFps = budget.fps;
      const startScale = budget.renderScale;
      let state = initialAdaptiveState();
      let clock = 10_000;
      for (let i = 0; i < 10; i++) {
        const next = nextAdaptiveStep(budget, overshoot, 1000 / Math.max(1, budget.fps), clock, state, 0);
        if (!next) break;
        expect(next.fps).toBeLessThanOrEqual(budget.fps);
        expect(next.renderScale).toBeLessThanOrEqual(budget.renderScale);
        budget = next;
        state = { lastStepAt: clock, stepIndex: state.stepIndex + 1 };
        clock += 10_000;
      }
      expect(budget.fps).toBeLessThanOrEqual(startFps);
      expect(budget.renderScale).toBeLessThanOrEqual(startScale);
      expect(budget.fps).toBe(15);
      expect(budget.renderScale).toBe(0.5);
    }
  });
});
