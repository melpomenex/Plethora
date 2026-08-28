import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameScheduler } from "../frameScheduler";

describe("createFrameScheduler", () => {
  let rafCallbacks: ((t: number) => number)[];
  let cancelled: number[];

  beforeEach(() => {
    rafCallbacks = [];
    cancelled = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(((cb: (t: number) => number) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as never);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(((id: number) => {
      cancelled.push(id);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Pump the loop: fire pending callbacks with increasing timestamps. */
  const pump = (timestamps: number[]) => {
    for (const t of timestamps) {
      const batch = rafCallbacks.splice(0);
      for (const cb of batch) cb(t);
    }
  };

  it("paces frames against the fps target", () => {
    const draws: number[] = [];
    const scheduler = createFrameScheduler({ draw: (t) => draws.push(t) });
    scheduler.start(30); // 33.33ms gate, lastTime starts at 0
    // t=5: skip (5 < 33.33). t=40: draw (lastTime→33.33). t=45: skip (11.67).
    // t=80: draw (lastTime→66.66). t=90: skip (23.34). t=120: draw (lastTime→99.99).
    pump([5, 40, 45, 80, 90, 120]);
    expect(draws).toEqual([40, 80, 120]);
    expect(scheduler.skipped).toBe(3);
    scheduler.stop();
  });

  it("carries the remainder so pacing stays locked to the interval", () => {
    const draws: number[] = [];
    const scheduler = createFrameScheduler({ draw: (t) => draws.push(t) });
    scheduler.start(10); // 100ms gate
    pump([50, 120, 210, 250, 320]);
    // 50 skip; 120 draw (lastTime→100); 210 draw (→200); 250 skip; 320 draw (→300)
    expect(draws).toEqual([120, 210, 320]);
    scheduler.stop();
  });

  it("never keeps two pending rAF handles", () => {
    const scheduler = createFrameScheduler({ draw: () => {} });
    scheduler.start(60);
    scheduler.start(60); // second start must not schedule another handle
    pump([0, 8, 16, 24]);
    expect(rafCallbacks.length).toBeLessThanOrEqual(1);
    scheduler.stop();
  });

  it("stop cancels the pending handle and is idempotent", () => {
    const scheduler = createFrameScheduler({ draw: () => {} });
    scheduler.start(60);
    scheduler.stop();
    scheduler.stop();
    expect(cancelled.length).toBe(1);
    expect(scheduler.running).toBe(false);
    const before = rafCallbacks.length;
    pump([100]);
    // The pending callback was consumed and the stopped loop rescheduled
    // nothing, so the queue drains to empty.
    expect(before).toBe(1);
    expect(rafCallbacks.length).toBe(0);
  });

  it("stop during a draw prevents rescheduling", () => {
    const scheduler = createFrameScheduler({
      draw: () => scheduler.stop(),
    });
    scheduler.start(60); // 16.67ms gate
    pump([20]); // t=20 opens the gate, draw calls stop()
    expect(scheduler.running).toBe(false);
    expect(rafCallbacks.length).toBe(0);
  });

  it("reports frame costs", () => {
    const costs: number[] = [];
    const scheduler = createFrameScheduler({ draw: () => {}, onFrameCost: (c) => costs.push(c) });
    scheduler.start(60);
    pump([20, 40]);
    expect(costs.length).toBe(2);
    expect(costs.every((c) => c >= 0)).toBe(true);
    scheduler.stop();
  });

  it("fps 0 means uncapped drawing", () => {
    const draws: number[] = [];
    const scheduler = createFrameScheduler({ draw: (t) => draws.push(t) });
    scheduler.start(0);
    pump([0, 1, 2, 3]);
    expect(draws.length).toBe(4);
    scheduler.stop();
  });

  it("restart resets pacing state", () => {
    const draws: number[] = [];
    const scheduler = createFrameScheduler({ draw: (t) => draws.push(t) });
    scheduler.start(10);
    pump([150]); // draw at 150, lastTime→100
    scheduler.stop();
    scheduler.start(10);
    pump([120]); // fresh lastTime=0 → 120 opens the gate
    expect(draws).toEqual([150, 120]);
    scheduler.stop();
  });
});
