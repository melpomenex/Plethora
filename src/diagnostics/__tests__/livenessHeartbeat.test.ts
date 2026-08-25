/**
 * Liveness-heartbeat gating tests (task 3.4 / 9.2): a production
 * configuration installs NO heartbeat interval; the reliability-harness
 * configuration (diagnostics gate on) still gets the liveness attribute.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLivenessHeartbeat, resetLivenessHeartbeatForTests } from "../livenessHeartbeat";

const setGate = (value: boolean | null) => {
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = value;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.removeAttribute("data-plethora-heartbeat");
  resetLivenessHeartbeatForTests();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  setGate(null);
});

describe("liveness heartbeat (3.4 / 9.2)", () => {
  it("installs no interval under a production configuration", () => {
    setGate(false);
    const spy = vi.spyOn(window, "setInterval");
    expect(installLivenessHeartbeat()).toBe(false);
    // No timer was armed and no attribute ever appears.
    vi.advanceTimersByTime(10_000);
    expect(document.body.getAttribute("data-plethora-heartbeat")).toBeNull();
    spy.mockRestore();
  });

  it("arms the liveness attribute for the reliability harness when gated on", () => {
    setGate(true);
    expect(installLivenessHeartbeat()).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(document.body.getAttribute("data-plethora-heartbeat")).toBe("1");
    vi.advanceTimersByTime(1_000);
    expect(document.body.getAttribute("data-plethora-heartbeat")).toBe("2");
  });

  it("is idempotent: a second call never installs a second interval", () => {
    setGate(true);
    installLivenessHeartbeat();
    installLivenessHeartbeat();
    vi.advanceTimersByTime(3_000);
    // Exactly one heartbeat number per second — a doubled interval would
    // reach 3 after 1.5 s.
    expect(document.body.getAttribute("data-plethora-heartbeat")).toBe("3");
  });
});
