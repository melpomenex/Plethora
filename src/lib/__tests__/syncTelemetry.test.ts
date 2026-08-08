import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSyncTelemetry,
  getSyncTelemetry,
  getTabSwitchLatency,
  markSyncPhaseStart,
  measureTabSwitch,
} from "../sync/syncTelemetry";

describe("tab-switch sync telemetry", () => {
  afterEach(() => {
    clearSyncTelemetry();
    vi.unstubAllGlobals();
  });

  it("records tab activation timing and the sync backlog through the next paint", () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });

    expect(measureTabSwitch(() => "active", () => 7)).toBe("active");
    expect(getSyncTelemetry()).toHaveLength(1);
    expect(getSyncTelemetry()[0]).toMatchObject({ phase: "tab-switch" });
    expect(getSyncTelemetry()[0].durationMs).toBeUndefined();

    frame?.(performance.now());

    expect(getSyncTelemetry()[0]).toMatchObject({
      phase: "tab-switch",
      outcome: "ok",
      surface: "tab-bar",
      queued: 7,
    });
    expect(getSyncTelemetry()[0].durationMs).toBeTypeOf("number");
  });
});

describe("getTabSwitchLatency", () => {
  let clock = 0;

  /**
   * Drive one complete tab switch of a known duration: the telemetry clock is
   * `performance.now()`, and the sample is finalized in the next animation
   * frame, so the stub advances the clock before invoking the callback.
   */
  function recordSwitch(durationMs: number) {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      clock += durationMs;
      callback(clock);
      return 1;
    });
    measureTabSwitch(() => null);
  }

  beforeEach(() => {
    clock = 0;
    clearSyncTelemetry();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    clearSyncTelemetry();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports no samples rather than zero milliseconds when nothing was measured", () => {
    expect(getTabSwitchLatency()).toEqual({ count: 0, p50: 0, p95: 0, max: 0 });
  });

  it("reports a single sample as every percentile", () => {
    recordSwitch(12);

    expect(getTabSwitchLatency()).toEqual({ count: 1, p50: 12, p95: 12, max: 12 });
  });

  it("computes nearest-rank percentiles over the recorded switches", () => {
    // Durations 1..20 ms, recorded out of order: p50 is the 10th smallest,
    // p95 the 19th, max the 20th.
    for (const ms of [20, 3, 11, 7, 1, 15, 9, 4, 18, 6, 13, 2, 17, 8, 5, 19, 10, 14, 12, 16]) {
      recordSwitch(ms);
    }

    expect(getTabSwitchLatency()).toEqual({ count: 20, p50: 10, p95: 19, max: 20 });
  });

  it("ignores phases that are not tab switches", () => {
    recordSwitch(5);
    markSyncPhaseStart("projection")({ outcome: "ok" });

    expect(getTabSwitchLatency()).toMatchObject({ count: 1, max: 5 });
  });
});
