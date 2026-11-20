import { describe, expect, it } from "vitest";
import { PlaybackCadenceMonitor } from "../cadenceMonitor";

describe("PlaybackCadenceMonitor", () => {
  it("steps down after two overloaded windows and falls back after two more", () => {
    const monitor = new PlaybackCadenceMonitor(20, 10);

    expect(monitor.record(5_000, 20, 5)).toBe("continue");
    expect(monitor.record(10_000, 20, 5)).toBe("step-down");
    expect(monitor.record(15_000, 20, 5)).toBe("continue");
    expect(monitor.record(20_000, 20, 5)).toBe("fallback");
  });

  it("resets the overload sequence after a healthy foreground window", () => {
    const monitor = new PlaybackCadenceMonitor(20, 10);

    expect(monitor.record(5_000, 20, 5)).toBe("continue");
    expect(monitor.record(10_000, 20, 4)).toBe("continue");
    expect(monitor.record(15_000, 20, 5)).toBe("continue");
    expect(monitor.record(20_000, 20, 5)).toBe("step-down");
  });
});
