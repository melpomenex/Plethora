import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("automatic startup work", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for local paint and yields between fallback tasks", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const { afterLocalStartupReady, markLocalStartupReady } = await import("../startupOptionalWork");
    const first = vi.fn();
    const second = vi.fn();
    afterLocalStartupReady(first);
    afterLocalStartupReady(second);
    vi.advanceTimersByTime(30_000);
    expect(first).not.toHaveBeenCalled();

    markLocalStartupReady();
    vi.advanceTimersByTime(2_999);
    expect(first).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(second).toHaveBeenCalledTimes(1);
    markLocalStartupReady();
    vi.runAllTimers();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("removes work whose owner unmounted before idle", async () => {
    const schedule = vi.fn();
    vi.stubGlobal("requestIdleCallback", schedule);
    const { afterLocalStartupReady, markLocalStartupReady } = await import("../startupOptionalWork");
    const task = vi.fn();
    const remove = afterLocalStartupReady(task);
    markLocalStartupReady();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
    remove();
    schedule.mock.calls[0][0]();
    expect(task).not.toHaveBeenCalled();
  });
});
