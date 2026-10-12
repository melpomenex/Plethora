import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Android startup diagnostics", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

  it("filters values as well as keys and remains observable behind a hung transport", async () => {
    const original = vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = await import("../startupDiagnostics");
    const forward = vi.fn(() => new Promise(() => {}));
    console.info = forward;
    diagnostics.recordAndroidStartupDiagnostic("snapshot-request-complete", {
      surface: "documents", durationMs: 120, outcome: "populated", documents: 2,
      title: "private title", documentId: "private-id", queueItems: Infinity,
    } as Parameters<typeof diagnostics.recordAndroidStartupDiagnostic>[1]);
    diagnostics.recordAndroidStartupDiagnostic("recovery-visible", {
      surface: "private title", outcome: "private content", attempt: -1,
    } as unknown as Parameters<typeof diagnostics.recordAndroidStartupDiagnostic>[1]);
    expect(forward).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledTimes(2);
    expect(diagnostics.getAndroidStartupTrace()[0]).toMatchObject({
      phase: "snapshot-request-complete", surface: "documents", durationMs: 120, documents: 2,
    });
    expect(JSON.stringify(diagnostics.getAndroidStartupTrace())).not.toMatch(/private|Infinity/);
    console.info = original;
  });

  it("bounds repeated warnings without suppressing the recovery marker", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = await import("../startupDiagnostics");
    for (let i = 0; i < 10000; i++) diagnostics.recordAndroidStartupDiagnostic("backend-ready-failed", { outcome: "timeout" });
    diagnostics.recordAndroidStartupDiagnostic("recovery-visible");
    expect(diagnostics.getAndroidStartupTrace()).toHaveLength(17);
    expect(info).toHaveBeenCalledTimes(17);
    const copy = diagnostics.getAndroidStartupTrace();
    copy.pop();
    expect(diagnostics.getAndroidStartupTrace()).toHaveLength(17);
  });

  it("waits for a confirmed committed surface, overlay removal, and an input turn", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = await import("../startupDiagnostics");
    document.body.innerHTML = '<div class="kp-overlay"></div>';
    const cancel = diagnostics.observeAndroidStartupSurface({ surface: "queue", outcome: "empty" });
    await vi.advanceTimersByTimeAsync(100);
    expect(diagnostics.getAndroidStartupTrace().some((r) => r.phase === "interaction-ready")).toBe(false);
    document.body.innerHTML = '<button>Queue</button>';
    await vi.advanceTimersByTimeAsync(100);
    expect(diagnostics.getAndroidStartupTrace().filter((r) => r.phase === "interaction-ready")).toHaveLength(1);
    cancel();
  });

  it("invalidates an old visible-surface observation", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const diagnostics = await import("../startupDiagnostics");
    const cancel = diagnostics.observeAndroidStartupSurface({ surface: "documents", outcome: "populated" });
    cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(diagnostics.getAndroidStartupTrace().some((r) => r.phase === "interaction-ready")).toBe(false);
  });

  it("classifies failures without retaining their messages", async () => {
    const { classifyAndroidStartupFailure } = await import("../startupDiagnostics");
    expect(classifyAndroidStartupFailure(new Error("request timed out"))).toBe("timeout");
    expect(classifyAndroidStartupFailure(new Error("IPC callback was dropped"))).toBe("transport");
    expect(classifyAndroidStartupFailure(new Error("SQLite database is locked"))).toBe("database");
  });
});
