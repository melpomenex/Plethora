import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSyncTelemetry,
  getSyncTelemetry,
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
