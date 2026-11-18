import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrontendStartupAttempt, STARTUP_DEADLINE_MS } from "../frontendStartupAttempt";

describe("frontend startup attempt", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["main", "local-data"] as const)("uses the same deadline when %s is stalled", (stalled) => {
    const failure = vi.fn();
    const attempt = createFrontendStartupAttempt(true, failure);
    vi.advanceTimersByTime(14_000);
    if (stalled === "main") attempt.dataLoaded();
    else attempt.mainLoaded();
    vi.advanceTimersByTime(999);
    expect(failure).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(failure).toHaveBeenCalledExactlyOnceWith("timeout");
    attempt.dataLoaded();
    attempt.mainLoaded();
    expect(attempt.failed).toBe(true);
  });

  it("reports terminal failure immediately and does not let it replace a later runtime", () => {
    const oldFailure = vi.fn();
    const earlier = createFrontendStartupAttempt(true, oldFailure);
    earlier.fail("error");
    expect(oldFailure).toHaveBeenCalledExactlyOnceWith("error");

    const failure = vi.fn();
    const current = createFrontendStartupAttempt(true, failure);
    earlier.dataLoaded();
    current.mainLoaded();
    current.dataLoaded();
    vi.advanceTimersByTime(STARTUP_DEADLINE_MS);
    expect(failure).not.toHaveBeenCalled();
  });

  it("does not wait on main-window data in utility windows", () => {
    const failure = vi.fn();
    const attempt = createFrontendStartupAttempt(false, failure);
    attempt.mainLoaded();
    vi.advanceTimersByTime(STARTUP_DEADLINE_MS);
    expect(failure).not.toHaveBeenCalled();
  });
});
